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
    email = (req.email or "").strip()
    if not email:
        raise HTTPException(400, "Email required to start trial")
    # Basic format check (full check lives in trial_tracker._is_valid_email).
    if "@" not in email or "." not in email.split("@")[-1] or " " in email:
        raise HTTPException(400, "Valid email required to start trial")

    try:
        status = trial_tracker.start_trial(req.hardware_id, req.device_info, email)
    except ValueError as e:
        raise HTTPException(400, str(e))
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
