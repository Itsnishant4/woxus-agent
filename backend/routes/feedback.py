import json
import logging
import os
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter

from ..models.schemas import FeedbackSubmit

logger = logging.getLogger(__name__)
router = APIRouter()

FEEDBACK_FILE = Path(__file__).resolve().parent.parent / "data" / "feedback.json"


def _ensure_store():
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not FEEDBACK_FILE.exists():
        FEEDBACK_FILE.write_text("[]")


def _save_to_mongo(entry: dict):
    try:
        import pymongo
        uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/woxus")
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
        db = client.get_database()
        db.feedback.insert_one({
            "rating": entry["rating"],
            "text": entry.get("text", ""),
            "hardwareId": entry.get("hardware_id", ""),
            "createdAt": datetime.utcnow(),
        })
        client.close()
    except Exception as e:
        logger.warning(f"Could not save feedback to MongoDB: {e}")


@router.post("/")
async def submit_feedback(req: FeedbackSubmit):
    _ensure_store()
    try:
        items = json.loads(FEEDBACK_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        items = []

    entry = {
        "rating": req.rating,
        "text": req.text or "",
        "hardware_id": req.hardware_id or "",
        "submitted_at": datetime.utcnow().isoformat(),
    }
    items.append(entry)
    FEEDBACK_FILE.write_text(json.dumps(items, indent=2))
    _save_to_mongo(entry)
    logger.info("Feedback saved: rating=%d", req.rating)
    return {"status": "submitted", "id": len(items)}


@router.get("/")
async def list_feedback():
    _ensure_store()
    try:
        items = json.loads(FEEDBACK_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        items = []
    return items
