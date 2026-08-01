"""Woxus — Gemini Live API service (native SDK pattern for low latency).

Mirrors the reference gemini-live-api-examples pattern:
- Uses client.aio.live.connect() with native session.send_realtime_input()
- Receives via session.receive() iterator
- No raw WebSocket framing bypass — uses the SDK directly
- Keeps key/model rotation + history replay on reconnect
"""

import asyncio
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
# voice turns survive session restarts (kept short to stay out of the
# real-time path). Runs in a thread executor — never blocks the hot path.
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
    """Gemini Live API session using the native google-genai SDK.

    On a session error the session is restarted with the same model and the
    conversation history is replayed as real turns so context survives.
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
        self._session_error: str | None = None
        self._stop_requested = False
        self.conversation_log: list[dict] = []
        self._last_log_ts = 0.0
        # Background tool tasks (e.g. delegate_task_to_mini_agent) that run
        # without blocking the Gemini receive loop.
        self._bg_tool_tasks: set[asyncio.Task] = set()

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
                    "You are Woxus, a smart and friendly voice assistant. "
                    "Keep spoken responses short and natural. Do NOT use markdown, bold, or headings.\n\n"
                    "DECISION RULES:\n"
                    "1. For CASUAL conversation, questions, and information requests (hello, how are you, "
                    "what is X, small talk, jokes, advice, reminders) — answer DIRECTLY in voice immediately. "
                    "NEVER call tools for these.\n"
                    "2. For COMPLEX COMPUTER TASKS only (create folder/project, install packages, run builds, "
                    "file operations, terminal work) — speak a brief acknowledgment FIRST (e.g. 'One moment, "
                    "checking that.'), then call delegate_task_to_mini_agent(task_prompt='...'), then report "
                    "the result in a second voice turn.\n"
                    "3. Never invent file names or paths — delegate to the agent which checks with tools.\n"
                    "4. Keep all spoken responses natural, clear, and conversational."
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
        """Build history turns (user/model alternating, no leading model turns)."""
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
        tool_result_callback: Callable[[str, Any], Awaitable[Any]] | None = None,
    ):
        """Open a Gemini Live session and run send/receive loops.

        If the session dies, reconnect with the same model up to
        MAX_SESSION_RETRIES times, replaying the conversation history as real
        turns so context survives.
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
                tool_result_callback=tool_result_callback,
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
        tool_result_callback: Callable[[str, Any], Awaitable[Any]] | None,
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
                    self._last_audio_sent_time = time.time()
                    await session.send_realtime_input(
                        audio=types.Blob(data=chunk, mime_type=mime_type)
                    )
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
                            await session.send_realtime_input(
                                text=types.LiveClientContent(
                                    turns=[
                                        types.Content(
                                            role=t["role"],
                                            parts=[types.Part(text=t["text"])],
                                        )
                                        for t in turns
                                    ],
                                    turn_complete=True,
                                )
                            )
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
                    await session.send_realtime_input(text=text)
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

        async def receive():
            try:
                while self._running:
                    async for response in session.receive():
                        # GoAway / resumption signals — log, keep listening
                        if response.go_away:
                            logger.warning("Received GoAway from Gemini: %s", response.go_away)
                        if response.session_resumption_update:
                            logger.info("Session resumption update: %s", response.session_resumption_update)

                        sc = response.server_content
                        if sc:
                            await _handle_server_content(
                                sc,
                                audio_output_callback,
                                audio_interrupt_callback,
                                transcription_callback,
                                latency_callback,
                            )

                        if response.tool_call:
                            await _handle_tool_call(response.tool_call)
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

        async def _handle_server_content(
            sc,
            audio_output_callback,
            audio_interrupt_callback,
            transcription_callback,
            latency_callback,
        ):
            """Process one serverContent block (native SDK objects)."""
            if sc.model_turn:
                for part in sc.model_turn.parts:
                    if part.inline_data:
                        await audio_output_callback(part.inline_data.data)

            # Output transcription → model log + UI
            if sc.output_transcription and sc.output_transcription.text:
                out_text = sc.output_transcription.text
                self._append_to_log("model", out_text)
                if transcription_callback:
                    await transcription_callback("gemini", out_text)

            # Input transcription → user log + UI
            if sc.input_transcription and sc.input_transcription.text:
                user_speech = sc.input_transcription.text
                self._append_to_log("user", user_speech)
                self._last_user_input_text = user_speech
                if self._user_input_time is None or self._has_logged_turn_latency:
                    self._user_input_time = time.time()
                    self._has_logged_turn_latency = False
                logger.info("🗣️ [SPEECH LOG] User spoke at %s: %s", time.strftime("%H:%M:%S"), user_speech)
                if transcription_callback:
                    await transcription_callback("user", user_speech)

            # Measure & log response latency on first turn output.
            if (sc.model_turn or (sc.output_transcription and sc.output_transcription.text)) and not self._has_logged_turn_latency:
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

            if sc.turn_complete:
                logger.info("🔚 [TURN COMPLETE] Turn finished. Ready for next user speech.")
                self._has_logged_turn_latency = False
                self._user_input_time = None
                self._last_user_input_text = ""
                self._last_audio_sent_time = None

            if sc.interrupted:
                logger.info("Gemini interrupted by user")
                self._has_logged_turn_latency = False
                self._user_input_time = None
                self._last_user_input_text = ""
                self._last_audio_sent_time = None
                if audio_interrupt_callback:
                    await audio_interrupt_callback()

        async def _run_tool_background(fn_name: str, fn_args: dict, fn_id: str):
            """Run a delegated tool (mini agent task) without blocking the
            Gemini receive loop. When it finishes, push the result to the
            frontend via tool_result_callback so the UI can show/paste it."""
            try:
                result = await handle_tool_call(fn_name, fn_args)
                logger.info("Background tool %s finished", fn_name)
            except Exception as e:
                logger.exception("Background tool %s failed: %s", fn_name, e)
                result = {"error": str(e)}
            if tool_result_callback:
                try:
                    await tool_result_callback(fn_name, result)
                except Exception as e:
                    logger.debug("tool_result_callback failed: %s", e)
            self._bg_tool_tasks.discard(asyncio.current_task())

        async def _handle_tool_call(tc):
            function_calls = tc.function_calls
            responses = []
            for fc in function_calls:
                fn_name = fc.name
                fn_id = fc.id
                fn_args = fc.args or {}
                logger.info("Tool call: %s(%s) [id=%s]", fn_name, fn_args, fn_id)

                if fn_name == "delegate_task_to_mini_agent":
                    # Non-blocking: ack Gemini immediately with an interim
                    # response so it can keep talking to the user, and run the
                    # actual (slow) mini-agent task in the background. The real
                    # result is delivered to the frontend when done via
                    # tool_result_callback — Gemini is never left hanging.
                    responses.append(types.FunctionResponse(
                        name=fn_name,
                        id=fn_id,
                        response={"output": {
                            "status": "started",
                            "message": "On it — I'll let you know when it's done.",
                        }},
                    ))
                    task = asyncio.create_task(
                        _run_tool_background(fn_name, fn_args, fn_id)
                    )
                    self._bg_tool_tasks.add(task)
                    task.add_done_callback(self._bg_tool_tasks.discard)
                    continue

                # Fast tools (read/status/memory) run inline — the conversation
                # benefits from the result immediately.
                result = await handle_tool_call(fn_name, fn_args)
                responses.append(types.FunctionResponse(
                    name=fn_name,
                    id=fn_id,
                    response={"output": result},
                ))
            if responses:
                await session.send_tool_response(function_responses=responses)
                logger.info("Sent %d tool response(s)", len(responses))

        try:
            # Seed the session with prior conversation turns only on reconnect.
            # On a fresh session, DON'T inject a greeting turn — that gets
            # interpreted as a command and can trigger tool/file side-effects.
            # The system instruction already primes the model; stay silent until
            # the user speaks (same behavior as the reference app).
            if replay_history:
                turns = self._history_turns()
                if turns:
                    await session.send_realtime_input(
                        text=types.LiveClientContent(
                            turns=[
                                types.Content(
                                    role=t["role"],
                                    parts=[types.Part(text=t["text"])],
                                )
                                for t in turns
                            ],
                            turn_complete=True,
                        )
                    )
                    logger.info("Replayed %d conversation turn(s) after reconnect", len(turns))

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

    def stop(self):
        self._stop_requested = True
        self._running = False
        # Cancel any still-running background tool tasks (full stop only —
        # session reconnects keep them alive so work isn't lost).
        for task in list(self._bg_tool_tasks):
            task.cancel()
        self._bg_tool_tasks.clear()

    @property
    def is_running(self) -> bool:
        return self._running
