from fastapi import APIRouter

from ..services.mini_tasks import get_mini_task_manager
from ..services.task_manager import get_task_manager

router = APIRouter()

@router.get("/")
async def list_tasks():
    tm = get_task_manager()
    tasks = tm.list()
    mini = get_mini_task_manager().list()
    return {
        "tasks": [t.to_dict() for t in tasks] + [t.to_dict() for t in mini],
        "mini_tasks": [t.to_dict() for t in mini],
        "count": len(tasks) + len(mini),
    }
