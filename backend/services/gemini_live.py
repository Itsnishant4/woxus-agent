"""Woxus — Gemini Live API service.

Mirrors the working reference implementation from
gemini-live-api-examples/gemini-live-genai-python-sdk/gemini_live.py

Handles bidirectional WebSocket streaming with Gemini Live:
- Sends microphone audio (16kHz PCM) and text input
- Receives AI audio (24kHz PCM) and transcription events
- Supports interruption / barge-in
- Optional tool calls for desktop automation
"""

import asyncio
import logging
import traceback
from typing import Any, Callable, Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


class GeminiLiveService:
    """Wraps the genai.Client Live API session for real‑time audio + text."""

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
        audio_output_callback: Callable[[bytes], Any],
        audio_interrupt_callback: Optional[Callable[[], Any]] = None,
        transcription_callback: Optional[Callable[[str, str], Any]] = None,
    ):
        """Open a Gemini Live session and run send/receive loops.

        Args:
            audio_input_queue: 16kHz Int16 PCM audio chunks from mic
            video_input_queue: JPEG image frames for camera/screen sharing
            text_input_queue: Text messages to send as conversation turns
            audio_output_callback: Called with 24kHz Int16 PCM audio for playback
            audio_interrupt_callback: Called when Gemini detects user interruption
            transcription_callback: Called with (role, text) for UI display
        """
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
                types.Part(text="You are Woxus, a helpful male AI companion. "
                                "Keep your responses concise and natural. "
                                "You help with everyday tasks, answer questions, "
                                "and have natural conversations.")
            ]),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            realtime_input_config=types.RealtimeInputConfig(
                turn_coverage="TURN_INCLUDES_ONLY_ACTIVITY",
            ),
            tools=self.tools,
        )

        logger.info("Connecting to Gemini Live (model=%s)", self.model)
        try:
            async with self.client.aio.live.connect(
                model=self.model, config=config
            ) as session:
                logger.info("Gemini Live session opened")
                self._running = True

                async def send_audio():
                    """Send microphone audio chunks to Gemini."""
                    try:
                        while True:
                            chunk = await audio_input_queue.get()
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=chunk,
                                    mime_type=f"audio/pcm;rate={self.input_sample_rate}",
                                )
                            )
                    except asyncio.CancelledError:
                        logger.debug("send_audio task cancelled")
                    except Exception as e:
                        logger.error(
                            "send_audio error: %s\n%s", e, traceback.format_exc()
                        )

                async def send_video():
                    """Send camera/screen images to Gemini (if enabled)."""
                    try:
                        while True:
                            chunk = await video_input_queue.get()
                            logger.info(
                                "Sending video frame: %d bytes", len(chunk)
                            )
                            await session.send_realtime_input(
                                video=types.Blob(data=chunk, mime_type="image/jpeg")
                            )
                    except asyncio.CancelledError:
                        logger.debug("send_video task cancelled")
                    except Exception as e:
                        logger.error(
                            "send_video error: %s\n%s", e, traceback.format_exc()
                        )

                async def send_text():
                    """Send text messages as conversation turns.

                    When text is sent, Gemini treats it as a user turn
                    (not realtime audio input) and generates a response.
                    """
                    try:
                        while True:
                            text = await text_input_queue.get()
                            logger.info("Sending text: %s", text[:80])
                            await session.send(
                                input=types.BidiGenerateContentClientContent(
                                    turns=[
                                        types.Content(
                                            role="user",
                                            parts=[types.Part(text=text)],
                                        )
                                    ],
                                )
                            )
                    except asyncio.CancelledError:
                        logger.debug("send_text task cancelled")
                    except Exception as e:
                        logger.error(
                            "send_text error: %s\n%s", e, traceback.format_exc()
                        )

                async def receive():
                    """Receive audio, transcriptions, and events from Gemini."""
                    try:
                        async for response in session.receive():
                            if not self._running:
                                break

                            # Handle server content (audio + turn info)
                            if response.server_content:
                                model_turn = response.server_content.model_turn
                                if model_turn:
                                    for part in model_turn.parts or []:
                                        # Audio output (24kHz PCM)
                                        if (
                                            hasattr(part, "inline_data")
                                            and part.inline_data
                                        ):
                                            audio_output_callback(
                                                part.inline_data.data
                                            )

                                        # Text content (from output transcription)
                                        if hasattr(part, "text") and part.text:
                                            if transcription_callback:
                                                transcription_callback(
                                                    "gemini", part.text
                                                )

                                # User interruption detected
                                if response.server_content.interrupted:
                                    logger.info(
                                        "Gemini interrupted by user"
                                    )
                                    if audio_interrupt_callback:
                                        audio_interrupt_callback()

                                # User transcript from input audio
                                if (
                                    response.server_content.turn_complete
                                    and transcription_callback
                                ):
                                    # Grab accumulated user transcription
                                    # This is sent as a separate event
                                    pass

                            # Handle tool calls (Phase 4: desktop control)
                            if response.tool_call:
                                for fc in response.tool_call.function_calls or []:
                                    logger.info(
                                        "Tool call: %s(args=%s)",
                                        fc.name,
                                        fc.args,
                                    )
                                    # Phase 4: route to tool_mapping

                    except asyncio.CancelledError:
                        logger.debug("receive task cancelled")
                    except Exception as e:
                        logger.error(
                            "receive error: %s\n%s",
                            e,
                            traceback.format_exc(),
                        )

                # Run all tasks concurrently
                await asyncio.gather(
                    send_audio(),
                    send_video(),
                    send_text(),
                    receive(),
                )

        except Exception as e:
            logger.error(
                "Gemini Live session error: %s\n%s", e, traceback.format_exc()
            )
        finally:
            self._running = False
            logger.info("Gemini Live session closed")

    def stop(self):
        """Signal the session loops to exit."""
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running
