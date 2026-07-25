"""Woxus — Gemini Live API service.

The google-genai SDK's send() method uses deprecated 'media_chunks' format
that the API rejects with 1007. This implementation sends the correct
wire format directly via the WebSocket, bypassing the SDK's send method.

Wire format (non-deprecated):
- Audio: {"realtime_input": {"audio": {"data": "<base64>", "mimeType": "audio/pcm;rate=16000"}}}
- Text:  {"client_content": {"turns": [...], "turn_complete": true}}
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

logger = logging.getLogger(__name__)


class GeminiLiveService:
    """Gemini Live API session using direct WebSocket messages."""

    def __init__(
        self,
        api_key: str,
        model: str,
        input_sample_rate: int = 16000,
        tools: Optional[list[Any]] = None,
        tool_mapping: Optional[dict[str, Any]] = None,
    ):
        self.api_key = api_key
        self.model = model
        self.input_sample_rate = input_sample_rate
        self.client = genai.Client(api_key=api_key)
        self.tools = tools or []
        self.tool_mapping = tool_mapping or {}
        self._running = False

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
                types.Part(text=(
                    "You are Woxus, a helpful male AI companion. "
                    "Keep your responses concise and natural. "
                    "You help with everyday tasks, answer questions, "
                    "and have natural conversations."
                ))
            ]),
            tools=self.tools,
        )

        logger.info("Connecting to Gemini Live (model=%s)", self.model)
        try:
            async with self.client.aio.live.connect(
                model=self.model, config=config
            ) as session:
                logger.info("Gemini Live session opened")
                self._running = True

                # Trigger AI to speak first when session opens
                text_input_queue.put_nowait("Hello")

                # Reference the internal WebSocket directly
                ws = session._ws
                mime_type = f"audio/pcm;rate={self.input_sample_rate}"

                async def send_audio():
                    """Send audio using correct wire format, bypassing SDK send()."""
                    try:
                        while self._running:
                            chunk = await audio_input_queue.get()
                            # Build the message in the NEW format (not media_chunks)
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
                        logger.debug("send_audio cancelled")
                    except Exception as e:
                        if self._running:
                            logger.error("send_audio error: %s", e)

                async def send_text():
                    """Send text as client_content."""
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
                        logger.debug("send_text cancelled")
                    except Exception as e:
                        if self._running:
                            logger.error("send_text error: %s", e)

                async def receive():
                    """Receive and process server messages."""
                    try:
                        while self._running:
                            # websockets ClientConnection uses recv(), not receive()
                            raw = await ws.recv()
                            data = json.loads(raw)
                            await self._handle_message(
                                data, audio_output_callback,
                                audio_interrupt_callback, transcription_callback,
                            )
                    except asyncio.CancelledError:
                        logger.debug("receive cancelled")
                    except Exception as e:
                        if self._running:
                            logger.error("receive error: %s", e)

                await asyncio.gather(
                    send_audio(),
                    send_text(),
                    receive(),
                )

        except Exception as e:
            logger.error("Gemini Live session error: %s\n%s", e, traceback.format_exc())
        finally:
            self._running = False
            logger.info("Gemini Live session closed")

    async def _handle_message(
        self, data: dict,
        audio_output_callback: Callable[[bytes], Awaitable[Any]],
        audio_interrupt_callback: Optional[Callable[[], Awaitable[Any]]],
        transcription_callback: Optional[Callable[[str, str], Awaitable[Any]]],
    ):
        """Process a single server message."""
        sc = data.get("serverContent")
        if not sc:
            return

        model_turn = sc.get("modelTurn")
        if model_turn:
            for part in model_turn.get("parts", []):
                inline = part.get("inlineData")
                if inline:
                    audio_bytes = base64.b64decode(inline["data"])
                    await audio_output_callback(audio_bytes)

                text = part.get("text")
                if text and transcription_callback:
                    await transcription_callback("gemini", text)

        inp = sc.get("inputTranscription")
        if inp and inp.get("text") and transcription_callback:
            await transcription_callback("user", inp["text"])

        out = sc.get("outputTranscription")
        if out and out.get("text") and transcription_callback:
            await transcription_callback("gemini", out["text"])

        if sc.get("interrupted"):
            logger.info("Gemini interrupted by user")
            if audio_interrupt_callback:
                await audio_interrupt_callback()

    def stop(self):
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running
