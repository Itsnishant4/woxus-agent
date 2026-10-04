"""Woxus — WhatsApp REST API (wacli backed)."""

import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..paths import woxus_data_dir
from ..services import whatsapp
from ..services.whatsapp_contacts import resolve_contact

logger = logging.getLogger(__name__)
router = APIRouter()

SETTINGS_FILE = woxus_data_dir() / "settings.json"


class WhatsappSendBody(BaseModel):
    to: str
    message: str
    confirm: bool = False
    pick: int | None = None


class WhatsappContactBody(BaseModel):
    name: str
    phone: str


@router.get("/status")
async def whatsapp_status():
    st = whatsapp.get_status()
    # attach NLP pool size (local + cached) without leaking numbers
    try:
        from ..services.whatsapp_contacts import _cached_wacli_contacts, _local_contacts

        st["contacts"] = len(_local_contacts()) + len(_cached_wacli_contacts())
    except Exception:
        st["contacts"] = 0
    return st


@router.post("/pair/start")
async def pair_start(body: dict | None = None):
    phone = (body or {}).get("phone") if isinstance(body, dict) else None
    return whatsapp.pair_start(phone)


@router.get("/pair/qr")
async def pair_qr():
    return whatsapp.pair_qr()


@router.post("/pair/cancel")
async def pair_cancel():
    return whatsapp.pair_cancel()


@router.post("/install")
async def install_wacli():
    return whatsapp.start_install()


@router.get("/install/status")
async def install_status():
    return whatsapp.install_status()


@router.post("/logout")
async def whatsapp_logout():
    return whatsapp.logout()


@router.get("/contacts/search")
async def contacts_search(q: str = ""):
    res = resolve_contact(q) if q else {"status": "unknown", "to_raw": q}
    return res


@router.get("/contacts")
async def contacts_list():
    try:
        data = json.loads(SETTINGS_FILE.read_text()) if SETTINGS_FILE.exists() else {}
    except Exception:
        data = {}
    return {"contacts": data.get("whatsapp_contacts", {}), "default_country": data.get("whatsapp_default_country", "")}


@router.put("/contacts")
async def contacts_save(body: dict):
    try:
        data = json.loads(SETTINGS_FILE.read_text()) if SETTINGS_FILE.exists() else {}
    except Exception:
        data = {}
    if "whatsapp_contacts" in body:
        if not isinstance(body["whatsapp_contacts"], dict):
            raise HTTPException(400, "whatsapp_contacts must be object")
        data["whatsapp_contacts"] = {str(k): str(v) for k, v in body["whatsapp_contacts"].items()}
    if "whatsapp_default_country" in body:
        data["whatsapp_default_country"] = str(body["whatsapp_default_country"])
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))
    return {"status": "updated"}


@router.post("/send")
async def whatsapp_send(body: WhatsappSendBody):
    to_raw = (body.to or "").strip()
    msg = (body.message or "").strip()
    if not to_raw or not msg:
        raise HTTPException(400, "to and message required")

    # pick N from ambiguous candidates — sends at once
    if body.pick is not None:
        preview = resolve_contact(to_raw)
        cands = preview.get("candidates", [])
        try:
            chosen = cands[int(body.pick)]
            to_send = chosen.get("phone", to_raw)
        except Exception:
            raise HTTPException(400, "invalid pick index") from None
        result = await whatsapp.send_text_async(to_send, msg)
        if isinstance(result, dict):
            result["matched"] = chosen.get("name", to_send)
        return result

    resolved = resolve_contact(to_raw)
    status = resolved.get("status")
    if status in ("exact", "fuzzy", "phone"):
        to_send = resolved.get("phone", to_raw)
        result = await whatsapp.send_text_async(to_send, msg)
        # attach NLP score for audit
        if isinstance(result, dict):
            result["nlp_score"] = resolved.get("score")
            result["matched"] = resolved.get("matched", to_send)
        return result
    if status == "ambiguous":
        return {"status": "needs_pick", "candidates": resolved.get("candidates", []), "score": resolved.get("score")}
    return {"status": "unknown_recipient", "to_raw": to_raw, "candidates": resolved.get("candidates", []), "reason": resolved.get("reason", "no match — add contact in Settings or sync wacli")}
