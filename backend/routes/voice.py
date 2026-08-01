"""Voice route — WebSocket relay between frontend and Gemini Live API.

Frontend sends 16-bit PCM audio + JSON text; receives 24kHz PCM audio + JSON events.
"""

import asyncio
import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import get_api_keys
from ..services.gemini_live import GeminiLiveService
from ..services.tool_definitions import agent_tools

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/live")
async def gemini_live_websocket(websocket: WebSocket):
    """WebSocket endpoint for Gemini Live voice streaming."""
    await websocket.accept()
    logger.info("Voice WebSocket connected")

    audio_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    video_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    text_input_queue: asyncio.Queue = asyncio.Queue()

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

    async def latency_callback(user_text: str, latency_ms: float):
        """Send response latency log to frontend for UI/console display."""
        try:
            latency_sec = round(latency_ms / 1000, 2)
            logger.info("⏱️ [LATENCY] Response to '%s' took %.2f ms (%.2f s)", user_text[:60], latency_ms, latency_sec)
            await websocket.send_json({
                "type": "latency_log",
                "user_text": user_text,
                "latency_ms": round(latency_ms, 2),
                "latency_sec": latency_sec,
            })
        except Exception:
            logger.debug("Failed to send latency log")

    config = websocket.app.state.config
    gemini_api_keys = get_api_keys()
    if all(k == "YOUR_GEMINI_API_KEY" for k in gemini_api_keys):
        gemini_api_keys = [config.get("GEMINI_API_KEY", "") or "YOUR_GEMINI_API_KEY"]
    gemini_models = ["gemini-2.5-flash-native-audio-preview-12-2025"]
    logger.info("Available Gemini Live models: %s", gemini_models)

    if not gemini_api_keys or gemini_api_keys == [""]:
        await websocket.send_json({"type": "error", "message": "GEMINI_API_KEY not configured"})
        await websocket.close()
        return

    system_instruction = (
        "You are Woxus, a voice assistant. Keep spoken responses short and natural. "
        "Do NOT read stored memories or call any memory/list tools.\n\n"
        "CONVERSATIONAL WORKFLOW RULES:\n"
        "1. FIRST RESPONSE: When the user asks a question or gives a command, speak a short acknowledgment FIRST (e.g. 'Wait, I am checking your Desktop now.' or 'Creating that for you now.').\n"
        "2. TOOL DELEGATION: Call `delegate_task_to_mini_agent(task_prompt='...')` to run the task via the Local Mini Agent.\n"
        "3. SECOND RESPONSE: After the Local Mini Agent completes and returns the output, speak the final result clearly (e.g. 'Your Desktop has folders woxus-core, projects, and notes.').\n"
        "4. Keep spoken responses natural, clear, and conversational. Do NOT use markdown, bold, or headings."
    )

    gemini_client = GeminiLiveService(
        api_keys=gemini_api_keys,
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
                        # Frontend wraps plain text as {"text": "..."}; unwrap it
                        if isinstance(payload, dict) and payload.get("text"):
                            text = payload["text"]
                    except json.JSONDecodeError:
                        pass

                    await text_input_queue.put(("text", text))

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
                latency_callback=latency_callback,
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
        if gemini_client._session_error:
            logger.error("Voice session ended with error: %s", gemini_client._session_error[:300])
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Voice session ended: {gemini_client._session_error[:300]}",
                })
            except Exception:
                pass