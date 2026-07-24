"""Chat route — streaming conversation with Gemini."""

from fastapi import APIRouter

router = APIRouter()


@router.post("/send")
async def send_message():
    """Send a message and receive a streaming response."""
    return {"message": "Endpoint not yet implemented (Phase 2)."}


@router.post("/regenerate")
async def regenerate():
    """Regenerate the last assistant message."""
    return {"message": "Endpoint not yet implemented (Phase 2)."}


@router.put("/{message_id}")
async def edit_message(message_id: str):
    """Edit a specific message."""
    return {"message": "Endpoint not yet implemented (Phase 2)."}


@router.delete("/{message_id}")
async def delete_message(message_id: str):
    """Delete a specific message."""
    return {"message": "Endpoint not yet implemented (Phase 2)."}
