"""Woxus — API endpoints for Local Model (SmolLM3 3B) status and download management."""

from fastapi import APIRouter

from ..services.local_model import get_model_status, start_model_download

router = APIRouter()


@router.get("/status")
async def model_status():
    """Get status of SmolLM3 3B local model installation and download progress."""
    return get_model_status()


@router.post("/download")
async def model_download():
    """Start background download of SmolLM3 3B local model."""
    return start_model_download()
