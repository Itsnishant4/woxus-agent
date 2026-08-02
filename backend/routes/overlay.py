import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

class ClarifyRequest(BaseModel):
    content: str | None = None
    conversation_id: str | None = None

# In-memory conversation history per overlay session (user text + final AI reply)
_conversations: dict[str, list[dict]] = {}
MAX_HISTORY = 50
MAX_HISTORY_CHARS = 12000

@router.get("/history")
async def overlay_history(conversation_id: str = ""):
    conv_id = conversation_id or "default"
    return {"conversation_id": conv_id, "history": _conversations.get(conv_id, [])}

@router.post("/clarify")
async def clarify_intent(req: ClarifyRequest, request: Request):
    try:
        content = (req.content or "").strip()

        if not content:
            return {"clarification": "Please type a request first."}

        conv_id = req.conversation_id or f"anon-{request.client.host if request.client else 'default'}"
        history = _conversations.setdefault(conv_id, [])[-MAX_HISTORY:]

        from ..services.local_model import run_overlay_agent

        result = await run_overlay_agent(content, history=history)

        output = result.get("mini_agent_output") or result.get("message") or ""
        reply = output.strip()

        history.append({"role": "user", "content": content})
        history.append({"role": "assistant", "content": reply})
        if len(history) > MAX_HISTORY:
            _conversations[conv_id] = history[-MAX_HISTORY:]
        else:
            total_chars = sum(len(str(m.get("content", ""))) for m in history)
            while total_chars > MAX_HISTORY_CHARS and len(history) > 2:
                dropped = history.pop(0)
                total_chars -= len(str(dropped.get("content", "")))
            _conversations[conv_id] = history

        return {"clarification": reply}

    except Exception as e:
        logger.error(f"Error running overlay agent: {e}")
        return {"clarification": "The overlay agent ran into an issue. Please try again."}
