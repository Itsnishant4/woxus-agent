"""Woxus — Gemini Live API service with tool calling support.

The google-genai SDK's send() method uses deprecated 'media_chunks' format
that the API rejects with 1007. This implementation sends the correct
wire format directly via the WebSocket, bypassing the SDK's send method.

Wire format (non-deprecated):
- Audio: {"realtime_input": {"audio": {"data": "<base64>", "mimeType": "audio/pcm;rate=16000"}}}
- Text:  {"client_content": {"turns": [...], "turn_complete": true}}
- Tool Response: {"tool_response": {"function_responses": [{"id": "...", "name": "...", "response": {...}}]}}
"""

import asyncio
import base64
import json
import logging
import time
import traceback
from collections.abc import Awaitable, Callable
from typing import Any

from google import genai
from google.genai import types

from .stt import transcribe_pcm16
from .tool_executor import handle_tool_call

logger = logging.getLogger(__name__)

MAX_HISTORY_TURNS = 10

# User audio is transcribed locally (whisper) in these rolling windows so
# voice turns survive session restarts (this Gemini model emits no
# inputTranscription). Kept short to stay out of Gemini's real-time path.
STT_WINDOW_SECONDS = 3
STT_MERGE_GAP_SECONDS = 2.0


def _transcribe_worker(svc: "GeminiLiveService", pcm: bytes):
    """Background whisper transcription of one audio window."""
    try:
        text = transcribe_pcm16(pcm)
        if not text:
            return
        now = time.time()
        log = svc.conversation_log
        if (
            log and log[-1]["role"] == "user"
            and now - svc._last_log_ts < STT_MERGE_GAP_SECONDS
        ):
            # Continuation of the same utterance across window boundaries
            log[-1]["text"] = text
        else:
            svc._append_to_log("user", text)
        svc._last_log_ts = now
        logger.info("🗣️ [SPEECH LOG] (whisper) User spoke: %s", text[:80])
    except Exception as e:
        logger.debug("Whisper transcription failed: %s", e)


class GeminiLiveService:
    """Gemini Live API session using direct WebSocket messages.

    On a session error (e.g. server 1007 close), the session is restarted with
    the same model and the conversation history is replayed as real
    client_content turns so context survives the reconnect.
    """

    def __init__(
        self,
        api_keys: str | list[str],
        models: list[str] | str,
        input_sample_rate: int = 16000,
        tools: list[Any] | None = None,
        system_instruction: str | None = None,
    ):
        if isinstance(api_keys, str):
            api_keys = [k.strip() for k in api_keys.split(",") if k.strip()]
        if not api_keys:
            api_keys = [""]
        self.api_keys = api_keys
        self._key_index = 0
        self.api_key = api_keys[0]
        self.models = [models] if isinstance(models, str) else models
        self.input_sample_rate = input_sample_rate
        self.client = genai.Client(api_key=self.api_key)
        self.tools = tools or []
        self.system_instruction = system_instruction
        self._running = False
        self.active_model = ""
        self._user_input_time = None
        self._last_user_input_text = ""
        self._has_logged_turn_latency = True
        self._turn_start = 0.0
        self._last_audio_sent_time = None
        self._last_response_text = ""
        self._session_error: str | None = None
        self._stop_requested = False
        self.conversation_log: list[dict] = []
        self._last_log_ts = 0.0

    def _rotate_key(self) -> bool:
        """Switch to the next API key. Returns False when no keys remain."""
        if self._key_index + 1 >= len(self.api_keys):
            return False
        self._key_index += 1
        self.api_key = self.api_keys[self._key_index]
        self.client = genai.Client(api_key=self.api_key)
        logger.warning("Switching Gemini API key to #%d of %d", self._key_index + 1, len(self.api_keys))
        return True

    def _build_config(self) -> types.LiveConnectConfig:
        """Build the Live session config. History is replayed as turns, never
        injected into the system instruction."""
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            ),
            # Mirror the working reference app: the server ends speech turns
            # based on actual audio activity (TURN_INCLUDES_ONLY_ACTIVITY), not
            # on silence while mic background noise keeps streaming. Without this
            # the default coverage keeps turns open — causing 20s+ latency / hangs.
            realtime_input_config=types.RealtimeInputConfig(
                turn_coverage="TURN_INCLUDES_ONLY_ACTIVITY",
            ),
            # Per-utterance transcription for accurate STT + latency measurement.
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            system_instruction=types.Content(parts=[
                types.Part(text=self.system_instruction or (
                    "You are Woxus Main Agent.\n\n"
                    "CONVERSATIONAL WORKFLOW RULES:\n"
                    "1. FIRST RESPONSE: When the user asks a question or gives a command, speak a short acknowledgment FIRST (e.g. 'Wait, I am checking your Desktop now.' or 'Creating that for you now.').\n"
                    "2. TOOL DELEGATION: Call `delegate_task_to_mini_agent(task_prompt='...')` to run the task via the Local Mini Agent.\n"
                    "3. SECOND RESPONSE: After the Local Mini Agent completes and returns the output, speak the final result clearly (e.g. 'Your Desktop has folders woxus-core, projects, and notes.').\n"
                    "4. Keep spoken responses natural, clear, and conversational. Do NOT use markdown, bold, or headings."
                )),
            ]),
            tools=self.tools,
        )

    def _append_to_log(self, role: str, text: str):
        """Record a conversation turn. Only consecutive 'model' entries merge
        (Gemini sends incremental transcription updates); user turns are
        always appended so distinct utterances are never lost."""
        text = (text or "").strip()
        if not text:
            return
        if (
            self.conversation_log
            and self.conversation_log[-1]["role"] == role
            and role == "model"
        ):
            self.conversation_log[-1]["text"] = text
        else:
            self.conversation_log.append({"role": role, "text": text})
            if len(self.conversation_log) > MAX_HISTORY_TURNS * 2:
                self.conversation_log = self.conversation_log[-(MAX_HISTORY_TURNS * 2):]

    def _history_turns(self) -> list[dict]:
        """Build client_content turns from the conversation log (user/model
        alternating, no leading model turns)."""
        turns = []
        for entry in self.conversation_log:
            turns.append({
                "role": entry["role"],
                "parts": [{"text": entry["text"]}],
            })
        while turns and turns[0]["role"] == "model":
            turns.pop(0)
        return turns

    async def start_session(
        self,
        audio_input_queue: asyncio.Queue[bytes],
        video_input_queue: asyncio.Queue[bytes],
        text_input_queue: asyncio.Queue[Any],
        audio_output_callback: Callable[[bytes], Awaitable[Any]],
        audio_interrupt_callback: Callable[[], Awaitable[Any]] | None = None,
        transcription_callback: Callable[[str, str], Awaitable[Any]] | None = None,
        latency_callback: Callable[[str, float], Awaitable[Any]] | None = None,
    ):
        """Open a Gemini Live session and run send/receive loops.

        If the session dies (e.g. server 1007 close), reconnect with the same
        model up to MAX_SESSION_RETRIES times, replaying the conversation
        history as real turns so context survives.
        """
        max_retries = 2
        attempt = 0
        self._key_index = 0
        self.api_key = self.api_keys[0]
        self.client = genai.Client(api_key=self.api_key)
        while True:
            config = self._build_config()
            replay_history = attempt > 0
            died_with_error = await self._run_session_once(
                config=config,
                audio_input_queue=audio_input_queue,
                text_input_queue=text_input_queue,
                audio_output_callback=audio_output_callback,
                audio_interrupt_callback=audio_interrupt_callback,
                transcription_callback=transcription_callback,
                latency_callback=latency_callback,
                replay_history=replay_history,
            )
            if self._stop_requested or not died_with_error or attempt >= max_retries:
                break
            attempt += 1
            logger.warning(
                "Gemini Live session dropped, reconnecting (attempt %d/%d) with %d history turn(s)...",
                attempt, max_retries, len(self.conversation_log),
            )
            await asyncio.sleep(1.0)

    async def _run_session_once(
        self,
        config: types.LiveConnectConfig,
        audio_input_queue: asyncio.Queue[bytes],
        text_input_queue: asyncio.Queue[Any],
        audio_output_callback: Callable[[bytes], Awaitable[Any]],
        audio_interrupt_callback: Callable[[], Awaitable[Any]] | None,
        transcription_callback: Callable[[str, str], Awaitable[Any]] | None,
        latency_callback: Callable[[str, float], Awaitable[Any]] | None,
        replay_history: bool = False,
    ) -> bool:
        """Run one session attempt. Returns True if the session died with an
        error and should be retried."""
        last_error = None
        cm = None
        session = None
        rotated = False
        while True:
            for i, model_name in enumerate(self.models):
                logger.info(
                    "Connecting to Gemini Live (attempt %d/%d, model=%s)",
                    i + 1, len(self.models), model_name,
                )
                try:
                    cm = self.client.aio.live.connect(
                        model=model_name, config=config
                    )
                    session = await cm.__aenter__()
                    self.active_model = model_name
                    last_error = None
                    logger.info("Gemini Live session opened with model=%s", model_name)
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    last_error = e
                    is_quota = any(
                        kw in err_str
                        for kw in ["quota", "rate", "429", "1011", "resource exhausted",
                                   "billing", "payment required"]
                    )
                    if is_quota and i + 1 < len(self.models):
                        logger.warning(
                            "Model %s quota exhausted, falling back to next...", model_name
                        )
                        continue
                    # Not a quota issue — likely a bad/quota'd key. Rotate and retry.
                    if self._rotate_key():
                        rotated = True
                        logger.warning(
                            "Model %s failed (%s), retrying with next API key", model_name, e
                        )
                        break
                    logger.error(
                        "Model %s failed (all API keys exhausted): %s", model_name, e
                    )
                    raise
            if session or not rotated:
                break
            rotated = False

        if not session:
            raise RuntimeError(f"All Gemini Live models exhausted: {last_error}")

        self._running = True
        self._session_error = None
        self._has_logged_turn_latency = True
        self._user_input_time = None
        self._last_user_input_text = ""
        self._turn_start = 0.0
        self._last_audio_sent_time = None

        try:
            ws = session._ws
            mime_type = f"audio/pcm;rate={self.input_sample_rate}"

            async def send_audio():
                stt_buffer = bytearray()
                try:
                    while self._running:
                        chunk = await audio_input_queue.get()
                        if chunk is None:
                            break
                        # Local whisper transcription window (non-blocking)
                        stt_buffer.extend(chunk)
                        window_bytes = self.input_sample_rate * 2 * STT_WINDOW_SECONDS
                        if len(stt_buffer) >= window_bytes:
                            window = bytes(stt_buffer[:window_bytes])
                            del stt_buffer[:window_bytes]
                            asyncio.get_running_loop().run_in_executor(
                                None, _transcribe_worker, self, window
                            )
                        b64_data = base64.b64encode(chunk).decode("utf-8")
                        self._last_audio_sent_time = time.time()
                        msg = json.dumps({
                            "realtime_input": {
                                "audio": {
                                    "data": b64_data,
                                    "mimeType": mime_type,
                                }
                            }
                        })
                        await ws.send(msg)
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    if self._running:
                        logger.error("send_audio error: %s", e)
                        self._session_error = str(e)
                        self._running = False
                        try:
                            text_input_queue.put_nowait(("stop", None))
                        except Exception:
                            pass

            async def send_text():
                try:
                    while self._running:
                        item = await text_input_queue.get()
                        if isinstance(item, tuple) and item[0] == "stop":
                            break
                        if isinstance(item, tuple) and item[0] == "history":
                            turns = item[1]
                            if turns:
                                msg = json.dumps({
                                    "client_content": {
                                        "turns": turns,
                                        "turn_complete": True,
                                    }
                                })
                                await ws.send(msg)
                                logger.info("Replayed %d history turn(s)", len(turns))
                            continue
                        text = item[1] if isinstance(item, tuple) else item
                        if isinstance(item, tuple) and item[0] == "text":
                            self._append_to_log("user", text)
                        self._user_input_time = time.time()
                        self._last_user_input_text = text
                        self._has_logged_turn_latency = False
                        self._turn_start = time.time()
                        logger.info("🗣️ [SPEECH LOG] User speaking text at %s: %s", time.strftime("%H:%M:%S"), text[:60] if len(text) > 60 else text)
                        logger.info("Sending text: %s", text[:80])
                        msg = json.dumps({
                            "client_content": {
                                "turns": [
                                    {"role": "user", "parts": [{"text": text}]}
                                ],
                                "turn_complete": True,
                            }
                        })
                        await ws.send(msg)
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    if self._running:
                        logger.error("send_text error: %s", e)
                        self._session_error = str(e)
                        self._running = False
                        try:
                            audio_input_queue.put_nowait(None)
                        except Exception:
                            pass

            async def _handle_tool_call_message(tc: dict):
                function_calls = tc.get("functionCalls", [])
                responses = []

                for fc in function_calls:
                    fn_name = fc.get("name", "")
                    fn_id = fc.get("id", "")
                    fn_args = fc.get("args", {})
                    logger.info("Tool call: %s(%s) [id=%s]", fn_name, fn_args, fn_id)
                    result = await handle_tool_call(fn_name, fn_args)
                    responses.append({
                        "id": fn_id,
                        "name": fn_name,
                        "response": {"output": result},
                    })

                msg = json.dumps({
                    "tool_response": {"function_responses": responses}
                })
                await ws.send(msg)
                logger.info("Sent %d tool response(s)", len(responses))

            async def receive():
                try:
                    while self._running:
                        raw = await ws.recv()
                        data = json.loads(raw)
                        tool_call = data.get("toolCall")
                        if tool_call:
                            await _handle_tool_call_message(tool_call)
                            continue
                        sc = data.get("serverContent")
                        if sc:
                            # Track response time
                            elapsed = time.time() - getattr(self, "_turn_start", 0.0)
                            self._turn_start = time.time()
                            await self._handle_message(
                                sc, audio_output_callback,
                                audio_interrupt_callback, transcription_callback,
                                latency_callback,
                            )
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    if self._running:
                        logger.error("receive error: %s", e)
                        self._session_error = str(e)
                        self._running = False
                        # Unblock the other loops so the session can die and
                        # the reconnect loop can start
                        try:
                            audio_input_queue.put_nowait(None)
                        except Exception:
                            pass
                        try:
                            text_input_queue.put_nowait(("stop", None))
                        except Exception:
                            pass

            # Seed the session: history as real conversation turns (reconnect),
            # or the greeting kicker on a fresh session.
            if replay_history:
                turns = self._history_turns()
                if turns:
                    msg = json.dumps({
                        "client_content": {
                            "turns": turns,
                            "turn_complete": True,
                        }
                    })
                    await ws.send(msg)
                    logger.info("Replayed %d conversation turn(s) after reconnect", len(turns))
            else:
                text_input_queue.put_nowait("Greet me.")

            await asyncio.gather(send_audio(), send_text(), receive())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Gemini Live session error: %s\n%s", e, traceback.format_exc())
            if not self._stop_requested:
                self._session_error = str(e)
        finally:
            self._running = False
            if cm is not None:
                await cm.__aexit__(None, None, None)
            logger.info("Gemini Live session closed")

        return self._session_error is not None and not self._stop_requested

    async def _handle_message(
        self, sc: dict,
        audio_output_callback: Callable[[bytes], Awaitable[Any]],
        audio_interrupt_callback: Callable[[], Awaitable[Any]] | None,
        transcription_callback: Callable[[str, str], Awaitable[Any]] | None,
        latency_callback: Callable[[str, float], Awaitable[Any]] | None = None,
    ):
        """Process a single serverContent message."""
        model_turn = sc.get("modelTurn")
        texts = []
        if model_turn:
            for part in model_turn.get("parts", []):
                inline = part.get("inlineData")
                if inline:
                    audio_bytes = base64.b64decode(inline["data"])
                    await audio_output_callback(audio_bytes)
                text = part.get("text")
                if text:
                    texts.append(text)

        out = sc.get("outputTranscription")
        out_text = out.get("text") if out else None
        logger.debug(
            "serverContent text_count=%d out=%s texts=%s",
            len(texts),
            out_text[:100] if out_text else "NONE",
            "|".join(t[:60] for t in texts[:2]) if texts else "NONE",
        )

        inp = sc.get("inputTranscription")
        if inp and inp.get("text"):
            user_speech = inp["text"]
            self._append_to_log("user", user_speech)
            self._last_user_input_text = user_speech
            if self._user_input_time is None or self._has_logged_turn_latency:
                self._user_input_time = time.time()
                self._has_logged_turn_latency = False
            logger.info("🗣️ [SPEECH LOG] User spoke at %s: %s", time.strftime("%H:%M:%S"), user_speech)
            if transcription_callback:
                await transcription_callback("user", user_speech)

        if out_text and transcription_callback:
            self._append_to_log("model", out_text)
            await transcription_callback("gemini", out_text)

        # Measure & log response latency on first turn output. For audio turns
        # (no inputTranscription on this model) the timer starts at the last
        # mic chunk sent — true speech-end -> response time.
        if (model_turn or out_text) and not self._has_logged_turn_latency:
            baseline = self._user_input_time
            if self._last_audio_sent_time and (
                baseline is None or self._last_audio_sent_time > baseline
            ):
                baseline = self._last_audio_sent_time
            if baseline is None:
                baseline = time.time()
            latency_ms = (time.time() - baseline) * 1000
            latency_sec = latency_ms / 1000
            self._has_logged_turn_latency = True
            user_label = self._last_user_input_text or "speech input"
            logger.info(
                "⏱️ [LATENCY LOG] Woxus response time for '%s': %.2f ms (%.2f s)",
                user_label,
                latency_ms,
                latency_sec,
            )
            if latency_callback:
                await latency_callback(user_label, latency_ms)

        if sc.get("turnComplete"):
            logger.info("🔚 [TURN COMPLETE] Turn finished. Ready for next user speech.")
            self._has_logged_turn_latency = False
            self._user_input_time = None
            self._last_user_input_text = ""
            self._last_audio_sent_time = None

        if sc.get("interrupted"):
            logger.info("Gemini interrupted by user")
            self._has_logged_turn_latency = False
            self._user_input_time = None
            self._last_user_input_text = ""
            self._last_audio_sent_time = None
            if audio_interrupt_callback:
                await audio_interrupt_callback()

    def stop(self):
        self._stop_requested = True
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running
