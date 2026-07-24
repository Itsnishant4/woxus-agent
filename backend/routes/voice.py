"""Voice route — WebSocket relay between frontend and Gemini Live API.

Mirrors the working reference main.py WebSocket endpoint.
Frontend sends 16-bit PCM audio + JSON text; receives audio + JSON events.
"""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.gemini_live import GeminiLiveService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/live")
async def gemini_live_websocket(websocket: WebSocket):
    """WebSocket endpoint for Gemini Live voice streaming.

    Protocol:
      Client → Server: Binary (16kHz Int16 PCM audio)
                        JSON {"text": "..."} for text input
                        JSON {"type": "image", "data": "...", "mime_type": "..."}
      Server → Client: Binary (24kHz Int16 PCM audio from Gemini)
                       JSON {"type": "user", "text": "..."} (user transcription)
                       JSON {"type": "gemini", "text": "..."} (gemini transcription)
                       JSON {"type": "interrupted"}
                       JSON {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info("Voice WebSocket connected")

    audio_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    video_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    text_input_queue: asyncio.Queue[str] = asyncio.Queue()

    async def audio_output_callback(data: bytes):
        """Relay Gemini audio response back to frontend."""
        try:
            await websocket.send_bytes(data)
        except Exception:
            logger.debug("Failed to send audio to frontend")

    async def audio_interrupt_callback():
        """Notify frontend that Gemini was interrupted by user speech."""
        try:
            await websocket.send_json({"type": "interrupted"})
        except Exception:
            logger.debug("Failed to send interrupt")

    async def transcription_callback(role: str, text: str):
        """Send speech transcription to frontend for UI display."""
        try:
            await websocket.send_json({"type": role, "text": text})
        except Exception:
            logger.debug("Failed to send transcription")

    config = websocket.app.state.config
    gemini_api_key = config.get("GEMINI_API_KEY")
    gemini_model = config.get("GEMINI_MODEL", "gemini-2.0-flash-live-preview")

    if not gemini_api_key:
        await websocket.send_json({
            "type": "error",
            "message": "GEMINI_API_KEY not configured"
        })
        await websocket.close()
        return

    gemini_client = GeminiLiveService(
        api_key=gemini_api_key,
        model=gemini_model,
        input_sample_rate=16000,
    )

    async def receive_from_client():
        """Read WebSocket messages and enqueue for Gemini."""
        try:
            while True:
                message = await websocket.receive()

                if message.get("bytes"):
                    # Binary PCM audio → Gemini audio input
                    await audio_input_queue.put(message["bytes"])
                elif message.get("text"):
                    text = message["text"]
                    try:
                        payload = json.loads(text)
                        # Image frame for camera/screen sharing
                        if isinstance(payload, dict) and payload.get("type") == "image":
                            logger.info(
                                "Received image chunk: %d base64 chars",
                                len(str(payload["data"])),
                            )
                            image_data = base64.b64decode(payload["data"])
                            await video_input_queue.put(image_data)
                            continue
                    except json.JSONDecodeError:
                        pass

                    # Plain text or text-typed JSON
                    await text_input_queue.put(text)

        except WebSocketDisconnect:
            logger.info("Frontend WebSocket disconnected")
        except Exception as e:
            logger.error("Error receiving from client: %s", e)

    # Run receive + Gemini session concurrently
    try:
        await asyncio.gather(
            receive_from_client(),
            gemini_client.start_session(
                audio_input_queue=audio_input_queue,
                video_input_queue=video_input_queue,
                text_input_queue=text_input_queue,
                audio_output_callback=audio_output_callback,
                audio_interrupt_callback=audio_interrupt_callback,
                transcription_callback=transcription_callback,
            ),
        )
    except Exception as e:
        logger.error("Gemini Live error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        gemini_client.stop()
