import json
import logging
import os
from datetime import datetime
from typing import Optional

from ..paths import woxus_data_dir

logger = logging.getLogger(__name__)

DATA_DIR = woxus_data_dir()
TRIAL_FILE = DATA_DIR / "trials.json"
TRIAL_DURATION_SECONDS = 600


def _get_trial_duration_from_mongo() -> int:
    try:
        import pymongo
        uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/woxus")
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
        db = client.get_database()
        setting = db.settings.find_one({"key": "trial_duration_seconds"})
        client.close()
        if setting:
            return int(setting["value"])
    except Exception as e:
        logger.warning(f"Could not read trial duration from MongoDB: {e}")
    return TRIAL_DURATION_SECONDS


def _has_existing_trial_in_mongo(hardware_id: str, email: Optional[str]) -> Optional[dict]:
    try:
        import pymongo
        uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/woxus")
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
        db = client.get_database()
        query: dict[str, str] = {"hardwareId": hardware_id}
        existing = db.users.find_one(query)
        if not existing and email:
            existing = db.users.find_one({"email": email})
        client.close()
        if existing:
            return {
                "active": existing.get("trialActive", False),
                "remaining_seconds": 0,
                "total_seconds": existing.get("trialDurationSeconds", TRIAL_DURATION_SECONDS),
                "email": existing.get("email", ""),
            }
    except Exception as e:
        logger.warning(f"Could not check trial in MongoDB: {e}")
    return None


def _upsert_user_to_mongo(hardware_id: str, email: Optional[str], device_info: Optional[str], total_seconds: int):
    try:
        import pymongo
        uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/woxus")
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
        db = client.get_database()
        db.users.update_one(
            {"hardwareId": hardware_id},
            {"$set": {
                "hardwareId": hardware_id,
                "email": email or "",
                "deviceInfo": device_info or "",
                "trialActive": True,
                "trialStartedAt": datetime.utcnow().isoformat(),
                "trialDurationSeconds": total_seconds,
                "lastActiveAt": datetime.utcnow().isoformat(),
            }},
            upsert=True,
        )
        client.close()
    except Exception as e:
        logger.warning(f"Could not upsert user to MongoDB: {e}")


def _ensure_store():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TRIAL_FILE.exists():
        TRIAL_FILE.write_text("{}")


def _load_trials() -> dict:
    _ensure_store()
    try:
        return json.loads(TRIAL_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        return {}


def _save_trials(trials: dict):
    TRIAL_FILE.write_text(json.dumps(trials, indent=2))


def start_trial(hardware_id: str, device_info: Optional[str] = None, email: Optional[str] = None) -> dict:
    trials = _load_trials()
    total_seconds = _get_trial_duration_from_mongo()

    existing_mongo = _has_existing_trial_in_mongo(hardware_id, email)
    if existing_mongo and hardware_id not in trials:
        return existing_mongo

    if hardware_id in trials:
        existing = trials[hardware_id]
        started = datetime.fromisoformat(existing["started_at"])
        elapsed = (datetime.utcnow() - started).total_seconds()
        remaining = max(0, existing["total_seconds"] - elapsed)

        if remaining > 0:
            return {
                "active": True,
                "remaining_seconds": int(remaining),
                "total_seconds": existing["total_seconds"],
                "email": existing.get("email"),
            }
        return {
            "active": False,
            "remaining_seconds": 0,
            "total_seconds": existing["total_seconds"],
            "email": existing.get("email"),
        }

    record = {
        "hardware_id": hardware_id,
        "device_info": device_info or "",
        "email": email or "",
        "started_at": datetime.utcnow().isoformat(),
        "total_seconds": total_seconds,
    }
    trials[hardware_id] = record
    _save_trials(trials)
    _upsert_user_to_mongo(hardware_id, email, device_info, total_seconds)

    return {
        "active": True,
        "remaining_seconds": total_seconds,
        "total_seconds": total_seconds,
        "email": record.get("email"),
    }


def get_trial_status(hardware_id: str) -> dict:
    trials = _load_trials()
    if hardware_id not in trials:
        total_seconds = _get_trial_duration_from_mongo()
        return {
            "active": False,
            "remaining_seconds": 0,
            "total_seconds": total_seconds,
            "email": None,
        }
    rec = trials[hardware_id]
    started = datetime.fromisoformat(rec["started_at"])
    elapsed = (datetime.utcnow() - started).total_seconds()
    remaining = max(0, rec["total_seconds"] - elapsed)
    return {
        "active": remaining > 0,
        "remaining_seconds": int(remaining),
        "total_seconds": rec["total_seconds"],
        "email": rec.get("email"),
    }
