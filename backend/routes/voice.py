"""Voice route — WebSocket relay between frontend and Gemini Live API.

Frontend sends 16-bit PCM audio + JSON text; receives 24kHz PCM audio + JSON events.
"""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.gemini_live import GeminiLiveService
from ..services.tool_definitions import agent_tools
from ..services.memory_engine import list_memories

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/live")
async def gemini_live_websocket(websocket: WebSocket):
    """WebSocket endpoint for Gemini Live voice streaming."""
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
        """Notify frontend that Gemini was interrupted."""
        try:
            await websocket.send_json({"type": "interrupted"})
        except Exception:
            logger.debug("Failed to send interrupt")

    async def transcription_callback(role: str, text: str):
        """Send speech transcription to frontend for UI display."""
        try:
            logger.info("Sending to frontend: type=%s text=%s", role, text[:100])
            await websocket.send_json({"type": role, "text": text})
        except Exception:
            logger.debug("Failed to send transcription")

    config = websocket.app.state.config
    gemini_api_key = config.get("GEMINI_API_KEY")
    gemini_model = config.get("GEMINI_MODEL", "")
    # User-configured model(s) first, then fallback list
    user_models = [m.strip() for m in gemini_model.split(",") if m.strip()]
    fallbacks = [
        "gemini-2.5-flash-native-audio-preview-12-2025",
        "gemini-2.0-flash-live-preview",
        "gemini-3.1-flash-live-preview",
        "gemini-3.0-flash-live-preview",
    ]
    gemini_models = user_models + [m for m in fallbacks if m not in user_models]
    logger.info("Available Gemini models: %s", gemini_models)

    if not gemini_api_key:
        await websocket.send_json({"type": "error", "message": "GEMINI_API_KEY not configured"})
        await websocket.close()
        return

    memories = list_memories()
    mem_lines = "\n".join(f"- {m['content']}" for m in memories) if memories else "None yet."
    system_instruction = (
        "You are Woxus, a desktop AI agent.\n\n"
        "RULES:\n"
        "- Output is shown in chat AND spoken as audio. Keep it under 10 words.\n"
        "- No markdown, bold, headings, or descriptions of your actions.\n"
        "- Use stored memories to personalize responses. Never ask to search memories.\n\n"
        f"STORED MEMORIES:\n{mem_lines}"
    )

    gemini_client = GeminiLiveService(
        api_key=gemini_api_key,
        models=gemini_models,
        input_sample_rate=16000,
        tools=agent_tools,
        system_instruction=system_instruction,
    )

    async def receive_from_client():
        """Read WebSocket messages and enqueue for Gemini."""
        try:
            while True:
                message = await websocket.receive()

                if message.get("bytes"):
                    await audio_input_queue.put(message["bytes"])
                elif message.get("text"):
                    text = message["text"]
                    try:
                        payload = json.loads(text)
                        if isinstance(payload, dict) and payload.get("type") == "image":
                            logger.info("Received image: %d bytes", len(payload["data"]))
                            image_data = base64.b64decode(payload["data"])
                            await video_input_queue.put(image_data)
                            continue
                    except json.JSONDecodeError:
                        pass

                    await text_input_queue.put(text)

        except WebSocketDisconnect:
            logger.info("Frontend WebSocket disconnected")
        except Exception as e:
            logger.error("Error receiving from client: %s", e)

    # Run receive loop and Gemini session concurrently
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