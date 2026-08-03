"""Bug reports — store locally and forward to the deployed admin panel.

The desktop app posts a bug report (title, description, optional screenshot
under 2 MB as a base64 data URL). It is persisted to a local JSON file for
offline records AND forwarded to the admin panel (woxus-a.vercel.app/api/bugs),
which writes it to the shared MongoDB the admin dashboard reads.
"""

import json
import logging
import os
import urllib.request
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models.schemas import BugReportSubmit

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_IMAGE_BYTES = 2 * 1024 * 1024  # 2 MB

BUG_FILE = Path(__file__).resolve().parent.parent / "data" / "bug_reports.json"


def _ensure_store():
    BUG_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not BUG_FILE.exists():
        BUG_FILE.write_text("[]")


def _image_decoded_size(image: str) -> int:
    """Approximate the decoded byte size of a base64 data URL without decoding."""
    b64 = image
    comma = image.find(",")
    if comma != -1:
        b64 = image[comma + 1:]
    padding = b64.count("=")
    return max(0, (len(b64) * 3 // 4) - padding)


def _save_to_admin(entry: dict) -> None:
    """Forward to the admin panel so the report reaches the shared MongoDB."""
    server = os.getenv("LICENSE_SERVER_URL", "https://woxus-a.vercel.app")
    if not server:
        return
    try:
        req = urllib.request.Request(
            server.rstrip("/") + "/api/bugs",
            data=json.dumps(entry).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except Exception as e:
        logger.warning("Could not forward bug report to admin: %s", e)


@router.post("/")
async def submit_bug(req: BugReportSubmit):
    if not req.title or not req.title.strip():
        raise HTTPException(400, "title required")
    if req.image and _image_decoded_size(req.image) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Screenshot must be under 2 MB")

    _ensure_store()
    try:
        items = json.loads(BUG_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        items = []

    entry = {
        "title": req.title.strip(),
        "description": req.description or "",
        "image": req.image or "",
        "hardware_id": req.hardware_id or "",
        "app_version": req.app_version or "",
        "submitted_at": datetime.utcnow().isoformat(),
    }
    items.append(entry)
    BUG_FILE.write_text(json.dumps(items, indent=2))
    _save_to_admin(entry)
    logger.info("Bug report saved: %s", entry["title"][:60])
    return {"status": "submitted", "id": len(items)}


@router.get("/")
async def list_bugs():
    _ensure_store()
    try:
        items = json.loads(BUG_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        items = []
    return items
