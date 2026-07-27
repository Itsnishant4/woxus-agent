import os
import json
import logging
from pathlib import Path

from fastapi import APIRouter

from ..models.schemas import ApiKeyUpdate, ApiKeyStatus, SettingsOut

logger = logging.getLogger(__name__)
router = APIRouter()

SETTINGS_FILE = Path(__file__).resolve().parent.parent / "data" / "settings.json"


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text())
        except json.JSONDecodeError:
            pass
    return {"keys": {}}


def _save_settings(data: dict):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


@router.get("/")
async def get_settings():
    data = _load_settings()
    return SettingsOut(
        keys=[
            ApiKeyStatus(
                provider=p,
                configured=bool(v),
                masked_key=v[:4] + "****" if v else "",
            )
            for p, v in data.get("keys", {}).items()
        ],
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
    )


@router.put("/")
async def update_settings(req: dict):
    data = _load_settings()
    data.update(req)
    _save_settings(data)
    return {"status": "updated"}


@router.get("/keys")
async def get_api_keys():
    data = _load_settings()
    return [
        ApiKeyStatus(
            provider=p,
            configured=bool(v),
            masked_key=v[:4] + "****" if v else "",
        )
        for p, v in data.get("keys", {}).items()
    ]


@router.put("/keys")
async def update_api_key(req: ApiKeyUpdate):
    data = _load_settings()
    data.setdefault("keys", {})[req.provider] = req.key
    _save_settings(data)
    return {"status": "updated", "provider": req.provider}


@router.delete("/keys/{provider}")
async def delete_api_key(provider: str):
    data = _load_settings()
    data.get("keys", {}).pop(provider, None)
    _save_settings(data)
    return {"status": "deleted", "provider": provider}
