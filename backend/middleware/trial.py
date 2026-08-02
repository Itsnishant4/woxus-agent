import logging

from fastapi import HTTPException, Request

from ..services import trial_tracker

logger = logging.getLogger(__name__)

TRIAL_SKIP_PATHS = {"/api/system/health", "/api/system/status", "/api/license/verify", "/api/trial/start", "/api/trial/status", "/api/model", "/api/tasks", "/api/memory", "/docs", "/openapi.json"}


async def trial_limiter_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if any(path.startswith(p) for p in TRIAL_SKIP_PATHS):
        return await call_next(request)

    hardware_id = request.headers.get("X-Hardware-Id")
    if not hardware_id:
        return await call_next(request)

    status = trial_tracker.get_trial_status(hardware_id)
    if not status.get("active"):
        return await call_next(request)

    return await call_next(request)
