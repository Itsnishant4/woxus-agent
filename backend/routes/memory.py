from typing import Optional

from fastapi import APIRouter, HTTPException

from ..models.schemas import MemoryCreate, MemoryUpdate, MemoryOut
from ..services import memory_engine

router = APIRouter()


@router.get("/")
async def list_memories(category: Optional[str] = None):
    mems = memory_engine.list_memories(category)
    return [MemoryOut(**m) for m in mems]


@router.get("/search")
async def search_memories(q: str):
    results = memory_engine.search_memories(q)
    return results


@router.post("/")
async def create_memory(req: MemoryCreate):
    mem = memory_engine.create_memory(req.category, req.content, req.importance)
    return MemoryOut(**mem)


@router.put("/{memory_id}")
async def update_memory(memory_id: str, req: MemoryUpdate):
    updates = req.model_dump(exclude_none=True)
    mem = memory_engine.update_memory(memory_id, updates)
    if mem is None:
        raise HTTPException(404, "Memory not found")
    return MemoryOut(**mem)


@router.delete("/{memory_id}")
async def delete_memory(memory_id: str):
    ok = memory_engine.delete_memory(memory_id)
    if not ok:
        raise HTTPException(404, "Memory not found")
    return {"status": "deleted"}
