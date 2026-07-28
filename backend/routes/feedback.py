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
        db.feedbacks.insert_one({
            "rating": entry["rating"],
            "text": entry.get("text", ""),
            "hardwareId": entry.get("hardware_id", ""),
            "createdAt": datetime.utcnow(),
        })
        client.close()
    except Exception as e:
        logger.warning(f"Could not save feedback to MongoDB: {e}")


def _has_existing_feedback(hardware_id: str) -> bool:
    try:
        import pymongo
        uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/woxus")
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
        db = client.get_database()
        exists = db.feedbacks.find_one({"hardwareId": hardware_id})
        client.close()
        return exists is not None
    except Exception as e:
        logger.warning(f"Could not check feedback in MongoDB: {e}")
        return False


@router.post("/")
async def submit_feedback(req: FeedbackSubmit):
    if req.hardware_id and _has_existing_feedback(req.hardware_id):
        return {"status": "already_submitted", "message": "You have already submitted feedback."}

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
