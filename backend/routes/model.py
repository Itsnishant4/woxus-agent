"""Woxus — API endpoints for Local Model (FunctionGemma 270M) status and download management."""

from fastapi import APIRouter
from ..services.local_model import get_model_status, start_model_download

router = APIRouter()


@router.get("/status")
async def model_status():
    """Get status of FunctionGemma 270M local model installation and download progress."""
    return get_model_status()


@router.post("/download")
async def model_download():
    """Start background download of FunctionGemma 270M local model."""
    return start_model_download()
