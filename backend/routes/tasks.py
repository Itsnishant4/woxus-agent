from fastapi import APIRouter

from ..services.task_manager import get_task_manager

router = APIRouter()


@router.get("/")
async def list_tasks():
    tm = get_task_manager()
    tasks = tm.list()
    return {
        "tasks": [t.to_dict() for t in tasks],
        "count": len(tasks),
    }
