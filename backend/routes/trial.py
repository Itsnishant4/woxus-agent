import logging

from fastapi import APIRouter, HTTPException

from ..models.schemas import TrialStartRequest, TrialStatusResponse
from ..services import trial_tracker

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/start")
async def trial_start(req: TrialStartRequest):
    if not req.hardware_id:
        raise HTTPException(400, "hardware_id required")
    if not req.email:
        raise HTTPException(400, "email required")

    status = trial_tracker.start_trial(req.hardware_id, req.device_info, req.email)
    return TrialStatusResponse(
        active=status["active"],
        remaining_seconds=status["remaining_seconds"],
        total_seconds=status["total_seconds"],
        email=status.get("email"),
    )


@router.get("/duration")
async def trial_duration():
    """Global trial duration from admin API — drives dynamic UI messages."""
    return {"total_seconds": trial_tracker.get_configured_duration()}

@router.get("/status")
async def trial_status(hardware_id: str):
    if not hardware_id:
        raise HTTPException(400, "hardware_id required")

    status = trial_tracker.get_trial_status(hardware_id)
    return TrialStatusResponse(
        active=status["active"],
        remaining_seconds=status["remaining_seconds"],
        total_seconds=status["total_seconds"],
        email=status.get("email"),
    )
