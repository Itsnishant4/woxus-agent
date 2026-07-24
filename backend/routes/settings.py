"""Settings route — API key management, provider switching, preferences."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def get_settings():
    """Return all settings."""
    return {"message": "Endpoint not yet implemented (Phase 2/5)."}


@router.put("/")
async def update_settings():
    """Update settings."""
    return {"message": "Endpoint not yet implemented (Phase 2/5)."}


@router.get("/keys")
async def get_api_keys():
    """Return masked API key statuses."""
    return {"message": "Endpoint not yet implemented (Phase 2/5)."}


@router.put("/keys")
async def update_api_key():
    """Add or update an API key."""
    return {"message": "Endpoint not yet implemented (Phase 2/5)."}


@router.delete("/keys/{provider}")
async def delete_api_key(provider: str):
    """Remove an API key."""
    return {"message": "Endpoint not yet implemented (Phase 2/5)."}
