import logging

from fastapi import APIRouter, HTTPException

from ..models.schemas import TerminalCommandRequest, TerminalCommandResponse
from ..services.terminal_exec import execute_command

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/execute")
async def terminal_execute(req: TerminalCommandRequest):
    if not req.command or not req.command.strip():
        raise HTTPException(400, "Command cannot be empty")

    result = await execute_command(req.command.strip())

    return TerminalCommandResponse(
        stdout=result["stdout"],
        stderr=result["stderr"],
        exit_code=result["exit_code"],
    )
