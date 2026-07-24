"""System route — health checks, status, system info."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    """Health check endpoint — used by Tauri to verify backend readiness."""
    return {"status": "ok", "version": "0.1.0", "name": "Woxus"}


@router.get("/status")
async def status():
    """Full system status: online, agent connected, memory loaded."""
    return {
        "backend": "online",
        "agent": "disconnected",
        "memory": "not_loaded",
        "voice": "disabled",
    }


@router.post("/shutdown")
async def shutdown():
    """Gracefully shut down the backend."""
    return {"message": "Shutdown initiated."}
