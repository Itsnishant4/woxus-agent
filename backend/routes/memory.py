"""Memory route — CRUD and search over stored memories."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_memories():
    """List all memories."""
    return {"message": "Endpoint not yet implemented (Phase 3)."}


@router.get("/search")
async def search_memories(q: str):
    """Semantic search over memories."""
    return {"message": "Endpoint not yet implemented (Phase 3)."}


@router.put("/{memory_id}")
async def update_memory(memory_id: str):
    """Update a specific memory."""
    return {"message": "Endpoint not yet implemented (Phase 3)."}


@router.delete("/{memory_id}")
async def delete_memory(memory_id: str):
    """Delete a specific memory."""
    return {"message": "Endpoint not yet implemented (Phase 3)."}


@router.post("/export")
async def export_memories():
    """Export all memories."""
    return {"message": "Endpoint not yet implemented (Phase 3)."}


@router.post("/import")
async def import_memories():
    """Import memories."""
    return {"message": "Endpoint not yet implemented (Phase 3)."}
