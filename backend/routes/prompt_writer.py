import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.prompt_writer import generate_prompt

logger = logging.getLogger(__name__)
router = APIRouter()


class PromptWriterRequest(BaseModel):
    intent: str
    context: Optional[str] = None


@router.post("/generate")
async def generate(req: PromptWriterRequest):
    if not req.intent or not req.intent.strip():
        raise HTTPException(400, "Intent is required")

    result = await generate_prompt(req.intent.strip(), req.context)

    if result.get("status") == "error":
        raise HTTPException(503, result.get("error", "Prompt generation failed"))

    return result
