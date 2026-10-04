"""Voice route — WebSocket relay between frontend and Gemini Live API.

Frontend sends 16-bit PCM audio + JSON text; receives 24kHz PCM audio + JSON events.
"""

import asyncio
import base64
import json
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.gemini_keys import refresh_gemini_api_keys
from ..services.gemini_live import GeminiLiveService
from ..services.memory_engine import list_memories
from ..services.tool_definitions import agent_tools

router = APIRouter()
logger = logging.getLogger(__name__)

# System instruction tuned for low latency.
#
# CRITICAL: Casual conversation (greetings, questions, small talk) must be
# answered DIRECTLY in voice — never routed through delegate_task_to_mini_agent.
# Delegating every turn to the local 3B model + shell execution is what caused
# the multi-second delays. Tool delegation is reserved for actual computer tasks
# (file/folder/terminal/build operations), and even then the model speaks a
# brief ack first so the user hears something immediately.
SYSTEM_INSTRUCTION = """
You are Woxus, a smart, friendly desktop voice assistant living on the user's computer. You help with everyday conversation and real computer tasks, and you speak the user's language. Everything you say is spoken aloud, so it must be short, natural, and conversational.

## Voice / output
- Keep every spoken response short, natural, warm, and clear.
- Never use markdown, bold, headings, bullets, or code fences — you are speaking, not writing.
- Reply in the same language the user is speaking.

## Operating principles
- Act when you have enough to act; ask only when truly needed, then act.
- Never claim an action happened unless it actually completed. When you delegate a computer task, say a short confirmation first, then report the result only after the agent confirms it.
- Do not guess or invent. If you are unsure about real computer state, delegate to the local agent, which checks with tools.

## Routing (decide on every request)
1. CASUAL / INFORMATION (hello, how are you, what is X, jokes, advice, reminders, opinions, small talk): answer DIRECTLY in voice immediately. NEVER call a tool.
2. TYPE / WRITE / PASTE / ENTER text or a prompt into the app where the user's cursor is. The user may say this in ANY language (for example: type the prompt, write this, paste it, type karo, taip kar de, type the prompt X). Call delegate_task_to_mini_agent(task_prompt='TYPE_TEXT: ' + the user's EXACT text). Preserve the user's words word-for-word — never summarize, rephrase, shorten, or translate them. This is a typing action, not a read + plan task. Ack briefly, delegate, then confirm once it lands.
3. OTHER COMPUTER TASKS (create a folder or project, install packages, run a build, read or write files, open or delete files, terminal work, list desktop contents): speak a short acknowledgment, then delegate to the local agent, then report the result in a second voice turn.
4. MEMORY: when the user shares a durable fact about themselves (name, preferred language, preferences, habits, projects, goals) or asks you to remember something, call memory_create(content='...') — only for lasting facts, never small talk.
5. WHATSAPP SEND (send WhatsApp to <name/phone> <text>, e.g. send WhatsApp to mom hello, message Rahul on WhatsApp): call whatsapp_send(to_raw='<verbatim name/phone>', message='<text>') ONCE — it resolves the name via NLP and sends immediately, no confirmation step. Then tell the user it was sent (or the error, e.g. not linked / unknown name). Never invent numbers.
6. PARALLEL + BARGE-IN: while one delegated task runs, the user can keep talking — take each new task immediately and delegate it too, never say "wait". When the user asks for SEVERAL INDEPENDENT things in one breath (e.g. "create folder X and send WhatsApp to mom"), call delegate_tasks_to_mini_agent(tasks=[...]) ONCE with one item per thing (short label each). Speak one brief ack first ("On both."), then report each result as it completes — background completions arrive as [System notice] turns naming the task; announce each briefly by its label. Check mini_task_status/mini_task_list if you lose track. Dependent steps that must run in order go in ONE task_prompt, never fanned out.

## Constraints
- Never invent file names or paths. If you need real computer state, delegate so the agent can check with tools.
- Keep every spoken response natural, clear, and conversational.
"""


@router.websocket("/live")
async def gemini_live_websocket(websocket: WebSocket):
    """WebSocket endpoint for Gemini Live voice streaming."""
    await websocket.accept()
    logger.info("Voice WebSocket connected")

    audio_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    video_input_queue: asyncio.Queue[bytes] = asyncio.Queue()
    text_input_queue: asyncio.Queue = asyncio.Queue()
    # Outbound audio is queued (not sent inline) so a slow renderer playback
    # queue can never stall Gemini's receive loop. Bounded; a full queue means
    # the client is far behind, so the newest chunk is dropped rather than
    # blocking the session.
    audio_output_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=256)
    # Approximate queued playback time. 24kHz 16-bit mono PCM = 48000 B/s.
    # Generation routinely outpaces realtime playback; without a cap every
    # reply waits behind stale audio and arrives minutes late. 10s keeps
    # normal long replies intact while cutting pathological backlogs.
    audio_backlog_bytes = 0
    MAX_BACKLOG_BYTES = 10 * 48000  # ~10s of audio; older is dropped, newest kept
    _last_backlog_warn = 0.0

    async def audio_output_callback(data: bytes):
        """Enqueue Gemini audio for the sender task. Non-blocking so the Gemini
        receive loop is never stalled by a slow renderer playback queue."""
        nonlocal audio_backlog_bytes, _last_backlog_warn
        try:
            audio_output_queue.put_nowait(data)
            audio_backlog_bytes += len(data)
            # Drop oldest while over budget so replies stay live, not queued.
            dropped = 0
            while audio_backlog_bytes > MAX_BACKLOG_BYTES:
                try:
                    stale = audio_output_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                audio_backlog_bytes = max(0, audio_backlog_bytes - len(stale))
                dropped += 1
            if dropped:
                now = time.time()
                if now - _last_backlog_warn > 10.0:
                    _last_backlog_warn = now
                    logger.warning("🔊 [AUDIO] dropped %d stale chunk(s) — keeping reply live", dropped)
        except asyncio.QueueFull:
            # Client is far behind — drop the newest chunk rather than block.
            logger.debug("Audio output queue full — dropping chunk")

    async def audio_sender():
        """Drain the outbound audio queue and push bytes to the renderer."""
        while True:
            data = await audio_output_queue.get()
            try:
                await websocket.send_bytes(data)
            except Exception:
                logger.debug("Failed to send audio to frontend")
                break

    async def audio_interrupt_callback():
        """Notify frontend that Gemini was interrupted + drop stale queued
        audio so the next reply starts immediately instead of waiting behind
        the interrupted turn's leftovers."""
        nonlocal audio_backlog_bytes
        drained = 0
        while True:
            try:
                stale = audio_output_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            audio_backlog_bytes = max(0, audio_backlog_bytes - len(stale))
            drained += 1
        if drained:
            logger.info("🔊 [AUDIO] interrupt — dropped %d stale chunk(s)", drained)
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

    async def tool_result_callback(name: str, result: dict):
        """Forward a completed background tool result to the frontend. The
        frontend pastes it (if it's a paste action) or shows an info line."""
        try:
            await websocket.send_json({"type": "tool_result", "name": name, "result": result})
            logger.info("🛠️ [TOOL RESULT] %s -> %s", name, str(result)[:200])
        except Exception:
            logger.debug("Failed to send tool result")

    # Admin-managed key pool: fetch the license-gated list from the admin
    # panel (falls back to local/env keys when offline or unlicensed).
    # The browser/Electron WebSocket API can't set custom headers, so the
    # library passes the license context as query params (headers are a fallback
    # for non-browser clients).
    license_key = (
        websocket.query_params.get("license_key")
        or websocket.headers.get("X-License-Key")
        or None
    )
    hardware_id = (
        websocket.query_params.get("hardware_id")
        or websocket.headers.get("X-Hardware-Id")
        or None
    )
    gemini_api_keys = await refresh_gemini_api_keys(license_key, hardware_id)
    gemini_models = ["gemini-2.5-flash-native-audio-preview-12-2025"]
    logger.info("Available Gemini Live models: %s", gemini_models)

    # When every key in the pool is exhausted at runtime, re-query the admin
    # API (bypassing the TTL cache) so the session pulls fresh keys instead of
    # failing on a stale/dead set.
    async def _refresh_keys() -> list[str]:
        return await refresh_gemini_api_keys(license_key, hardware_id, force_refresh=True)

    if not gemini_api_keys or gemini_api_keys == [""]:
        await websocket.send_json({"type": "error", "message": "GEMINI_API_KEY not configured"})
        await websocket.close()
        return

    # Inject the most important stored memories into the system prompt so Woxus
    # knows them from the very first turn. Capped so a large memory store can't
    # inflate the prompt and slow the first token (list_memories sorts by
    # importance descending).
    try:
        memories = list_memories()[:6]
        mem_lines = "\n".join(f"- {m['content']}" for m in memories) if memories else "None yet."
        if len(mem_lines) > 800:
            mem_lines = mem_lines[:797] + "..."
    except Exception as e:
        logger.warning("Memory injection failed: %s", e)
        mem_lines = "None yet."

    system_instruction = SYSTEM_INSTRUCTION + (
        "\n\nPERSISTENT USER MEMORY (always follow these — they are facts about the user):\n"
        f"{mem_lines}\n"
        "Examples: if memory says the user prefers Gujarati, respond in Gujarati; "
        "if it records a name, use it; if it records a preference, honor it."
    )

    gemini_client = GeminiLiveService(
        api_keys=gemini_api_keys,
        models=gemini_models,
        input_sample_rate=16000,
        tools=agent_tools,
        system_instruction=system_instruction,
        key_refresher=_refresh_keys,
    )

    async def receive_from_client():
        """Read WebSocket messages and enqueue for Gemini."""
        try:
            while True:
                message = await websocket.receive()
                # Starlette returns a websocket.disconnect message once, then
                # raises RuntimeError on the NEXT receive() call. Break here so
                # a clean session close doesn't spam "Cannot call receive once
                # a disconnect message has been received".
                if message.get("type") == "websocket.disconnect":
                    logger.info("Frontend WebSocket disconnected")
                    break

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

    # Run receive loop, audio sender, and Gemini session concurrently
    audio_sender_task = asyncio.create_task(audio_sender())
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
                tool_result_callback=tool_result_callback,
            ),
        )
    except Exception as e:
        logger.error("Gemini Live error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        audio_sender_task.cancel()
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
