import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..models.schemas import SendMessageRequest, SendMessageResponse
from ..services.memory_engine import create_memory, search_memories

logger = logging.getLogger(__name__)
router = APIRouter()

conversations: dict[str, list[dict]] = {}


@router.post("/send")
async def send_message(req: SendMessageRequest):
    conv_id = req.conversation_id or uuid.uuid4().hex[:16]
    if conv_id not in conversations:
        conversations[conv_id] = []
        logger.info("Created conversation %s", conv_id)

    msg_id = uuid.uuid4().hex[:16]
    conversations[conv_id].append({
        "id": msg_id,
        "role": "user",
        "content": req.content,
        "timestamp": datetime.utcnow().isoformat(),
    })

    reply = f"Echo: {req.content} — replace with Gemini call in Phase 6"
    assistant_id = uuid.uuid4().hex[:16]
    conversations[conv_id].append({
        "id": assistant_id,
        "role": "assistant",
        "content": reply,
        "timestamp": datetime.utcnow().isoformat(),
    })

    return SendMessageResponse(
        conversation_id=conv_id,
        message_id=assistant_id,
        content=reply,
    )


@router.get("/conversations")
async def list_conversations():
    return [
        {"id": cid, "message_count": len(msgs), "last_message": msgs[-1]["content"][:100] if msgs else ""}
        for cid, msgs in conversations.items()
    ]


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    msgs = conversations.get(conversation_id)
    if msgs is None:
        raise HTTPException(404, "Conversation not found")
    return {"id": conversation_id, "messages": msgs}


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    if conversation_id not in conversations:
        raise HTTPException(404, "Conversation not found")
    del conversations[conversation_id]
    return {"status": "deleted"}
