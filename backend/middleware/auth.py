import logging

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from ..services.license import verify_key

logger = logging.getLogger(__name__)

SKIP_PATHS = {"/api/system/health", "/api/system/status", "/api/license/verify", "/api/trial/start", "/api/trial/status", "/api/trial/duration", "/api/whatsapp", "/api/model", "/api/tasks", "/api/memory", "/api/feedback", "/api/overlay", "/api/bugs", "/docs", "/openapi.json"}


async def license_check_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if any(path.startswith(p) for p in SKIP_PATHS):
        return await call_next(request)

    license_key = request.headers.get("X-License-Key")
    hardware_id = request.headers.get("X-Hardware-Id")

    if license_key and hardware_id:
        result = verify_key(license_key, hardware_id)
        if result.get("valid"):
            return await call_next(request)

    return JSONResponse(
        status_code=402,
        content={"error": "Valid license key required", "code": "LICENSE_REQUIRED"},
    )
