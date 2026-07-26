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
import traceback
from collections.abc import Awaitable
from typing import Any, Callable, Optional

from google import genai
from google.genai import types

from .tool_executor import handle_tool_call

logger = logging.getLogger(__name__)


class GeminiLiveService:
    """Gemini Live API session using direct WebSocket messages."""

    def __init__(
        self,
        api_key: str,
        models: list[str] | str,
        input_sample_rate: int = 16000,
        tools: Optional[list[Any]] = None,
    ):
        self.api_key = api_key
        self.models = [models] if isinstance(models, str) else models
        self.input_sample_rate = input_sample_rate
        self.client = genai.Client(api_key=api_key)
        self.tools = tools or []
        self._running = False
        self.active_model = ""

    async def start_session(
        self,
        audio_input_queue: asyncio.Queue[bytes],
        video_input_queue: asyncio.Queue[bytes],
        text_input_queue: asyncio.Queue[str],
        audio_output_callback: Callable[[bytes], Awaitable[Any]],
        audio_interrupt_callback: Optional[Callable[[], Awaitable[Any]]] = None,
        transcription_callback: Optional[Callable[[str, str], Awaitable[Any]]] = None,
    ):
        """Open a Gemini Live session and run send/receive loops."""
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            ),
            system_instruction=types.Content(parts=[
                types.Part(text="You are Woxus, a desktop AI agent.\n\nINCORRECT output (never do this):\n**Initiating Memory Search** I am searching for your name.\n**Querying Identity** Let me look that up.\nI will now formulate a response.\n\nCORRECT output:\nHello Nishant!\nName?\nLanguage?\n\nRULES:\n- Output is shown in chat AND spoken as audio. Keep it under 10 words.\n- No markdown, bold, headings, or descriptions of your actions.\n- Session start: search memory. Found name+language? Greet. Not found? Ask 'Name?' or 'Language?'.")
            ]),
            tools=self.tools,
        )

        # Try models in order until one connects
        last_error = None
        cm = None
        session = None
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
                logger.error(
                    "Model %s failed (not a quota issue): %s", model_name, e
                )
                raise

        if not session or last_error:
            if last_error:
                logger.error("All models exhausted: %s", last_error)
            return

        self._running = True

        try:
            text_input_queue.put_nowait("Greet me.")

            ws = session._ws
            mime_type = f"audio/pcm;rate={self.input_sample_rate}"

            async def send_audio():
                try:
                    while self._running:
                        chunk = await audio_input_queue.get()
                        b64_data = base64.b64encode(chunk).decode("utf-8")
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

            async def send_text():
                try:
                    while self._running:
                        text = await text_input_queue.get()
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
                            await self._handle_message(
                                sc, audio_output_callback,
                                audio_interrupt_callback, transcription_callback,
                            )
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    if self._running:
                        logger.error("receive error: %s", e)

            await asyncio.gather(send_audio(), send_text(), receive())
        except Exception as e:
            logger.error("Gemini Live session error: %s\n%s", e, traceback.format_exc())
        finally:
            self._running = False
            if cm is not None:
                await cm.__aexit__(None, None, None)
            logger.info("Gemini Live session closed")

    async def _handle_message(
        self, sc: dict,
        audio_output_callback: Callable[[bytes], Awaitable[Any]],
        audio_interrupt_callback: Optional[Callable[[], Awaitable[Any]]],
        transcription_callback: Optional[Callable[[str, str], Awaitable[Any]]],
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
        logger.info(
            "serverContent text_count=%d out=%s texts=%s",
            len(texts),
            out_text[:100] if out_text else "NONE",
            "|".join(t[:60] for t in texts[:2]) if texts else "NONE",
        )

        if out_text and transcription_callback:
            await transcription_callback("gemini", out_text)
        elif texts and transcription_callback:
            combined = " ".join(texts)
            display = combined.replace("**", "").strip()
            if display:
                await transcription_callback("gemini", display[:200])

        inp = sc.get("inputTranscription")
        if inp and inp.get("text") and transcription_callback:
            await transcription_callback("user", inp["text"])

        if sc.get("interrupted"):
            logger.info("Gemini interrupted by user")
            if audio_interrupt_callback:
                await audio_interrupt_callback()

    def stop(self):
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running
