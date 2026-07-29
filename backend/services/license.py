import json
import logging
import uuid
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import pymongo

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LICENSE_FILE = DATA_DIR / "licenses.json"

_mongo_client = None

def _get_mongo_collection():
    global _mongo_client
    uri = os.getenv("MONGODB_URI", "")
    if not uri:
        return None
    try:
        if _mongo_client is None:
            _mongo_client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=2000)
        return _mongo_client.get_database()["licenses"]
    except Exception:
        return None


def _ensure_store():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not LICENSE_FILE.exists():
        LICENSE_FILE.write_text("[]")


def _load_licenses() -> list[dict]:
    _ensure_store()
    try:
        return json.loads(LICENSE_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _save_licenses(licenses: list[dict]):
    LICENSE_FILE.write_text(json.dumps(licenses, indent=2))


def generate_key(expiry_days: int = 365, features: Optional[list[str]] = None) -> dict:
    key = f"WOX-{uuid.uuid4().hex[:12].upper()}"
    record = {
        "key": key,
        "expiry": (datetime.utcnow() + timedelta(days=expiry_days)).isoformat(),
        "features": features or ["all"],
        "hardware_ids": [],
        "revoked": False,
        "created_at": datetime.utcnow().isoformat(),
    }
    licenses = _load_licenses()
    licenses.append(record)
    _save_licenses(licenses)
    return record


def verify_key(license_key: str, hardware_id: str) -> dict:
    licenses = _load_licenses()
    for lic in licenses:
        if lic["key"] != license_key:
            continue
        if lic.get("revoked"):
            return {"valid": False, "reason": "License revoked"}
        if lic["expiry"] and datetime.fromisoformat(lic["expiry"]) < datetime.utcnow():
            return {"valid": False, "reason": "License expired"}
        if hardware_id not in lic.get("hardware_ids", []):
            lic.setdefault("hardware_ids", []).append(hardware_id)
            _save_licenses(licenses)
        return {
            "valid": True,
            "expiry": lic["expiry"],
            "features": lic.get("features", []),
        }

    # Fallback: check MongoDB (admin-generated keys)
    col = _get_mongo_collection()
    if col is not None:
        try:
            doc = col.find_one({"key": license_key})
            if doc:
                if doc.get("revoked"):
                    return {"valid": False, "reason": "License revoked"}
                if doc.get("expiry") and doc["expiry"] < datetime.utcnow():
                    return {"valid": False, "reason": "License expired"}
                hw_ids = doc.get("hardwareIds") or []
                if hardware_id not in hw_ids:
                    col.update_one(
                        {"_id": doc["_id"]},
                        {"$push": {"hardwareIds": hardware_id}, "$inc": {"activationCount": 1}},
                    )
                expiry_str = doc["expiry"].isoformat() if doc.get("expiry") else None
                return {
                    "valid": True,
                    "expiry": expiry_str,
                    "features": doc.get("features", ["all"]),
                }
        except Exception:
            logger.warning("MongoDB license check failed", exc_info=True)

    return {"valid": False, "reason": "Invalid license key"}
