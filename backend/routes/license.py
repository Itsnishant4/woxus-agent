import logging

from fastapi import APIRouter, HTTPException

from ..models.schemas import LicenseVerifyRequest, LicenseVerifyResponse
from ..services.license import verify_key, generate_key

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/verify")
async def license_verify(req: LicenseVerifyRequest):
    if not req.license_key or not req.hardware_id:
        raise HTTPException(400, "license_key and hardware_id required")

    result = verify_key(req.license_key, req.hardware_id)
    return LicenseVerifyResponse(
        valid=result["valid"],
        expiry=result.get("expiry"),
        features=result.get("features", []),
        reason=result.get("reason"),
    )


@router.post("/generate")
async def license_generate(expiry_days: int = 365):
    record = generate_key(expiry_days=expiry_days)
    return {
        "key": record["key"],
        "expiry": record["expiry"],
        "features": record["features"],
    }
