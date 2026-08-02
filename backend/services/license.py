import json
import logging
import os
import urllib.request
import uuid
from datetime import UTC, datetime, timedelta, timezone

from ..paths import woxus_data_dir

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _parse_expiry(value) -> datetime | None:
    """Normalize expiry (datetime, ISO string, possibly with 'Z') to aware UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value
    if isinstance(value, str):
        s = value.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt
    return None

DATA_DIR = woxus_data_dir()
LICENSE_FILE = DATA_DIR / "licenses.json"

_mongo_client = None

LICENSE_SERVER_TIMEOUT_SECONDS = 6

def _get_mongo_collection():
    global _mongo_client
    uri = os.getenv("MONGODB_URI", "")
    if not uri:
        return None
    try:
        # Lazy import: pymongo is a dev-only fallback (not in requirements.txt),
        # so it isn't bundled into the packaged app. Import it here so an absent
        # pymongo degrades to "no Mongo fallback" instead of crashing startup.
        import pymongo
        if _mongo_client is None:
            _mongo_client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=800)
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


def _verify_remote(license_key: str, hardware_id: str) -> dict | None:
    """Verify against deployed admin panel. Returns None when unreachable."""
    server = os.getenv("LICENSE_SERVER_URL", "https://woxus-a.vercel.app")
    if not server:
        return None
    try:
        req = urllib.request.Request(
            server.rstrip("/") + "/api/verify-key",
            data=json.dumps({"license_key": license_key, "hardware_id": hardware_id}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=LICENSE_SERVER_TIMEOUT_SECONDS) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        logger.warning("License server unreachable: %s", e)
        return None


def _cache_remote_license(result: dict, license_key: str, hardware_id: str):
    """Persist a server-verified license locally so it works when admin panel is down."""
    if not result.get("valid"):
        return
    licenses = _load_licenses()
    now = _utcnow().isoformat()
    for lic in licenses:
        if lic["key"] == license_key:
            hw_ids = lic.setdefault("hardware_ids", [])
            if hardware_id not in hw_ids:
                hw_ids.append(hardware_id)
            lic["expiry"] = result.get("expiry")
            lic["features"] = result.get("features") or ["all"]
            lic["revoked"] = False
            lic["verified_at"] = now
            _save_licenses(licenses)
            return
    licenses.append({
        "key": license_key,
        "expiry": result.get("expiry"),
        "features": result.get("features") or ["all"],
        "hardware_ids": [hardware_id],
        "max_activations": 99,
        "revoked": False,
        "created_at": now,
        "verified_at": now,
        "cached_from_server": True,
    })
    _save_licenses(licenses)


def _find_cached(license_key: str) -> dict | None:
    for lic in _load_licenses():
        if lic["key"] == license_key:
            return lic
    return None


def _drop_cached(license_key: str):
    licenses = [lic for lic in _load_licenses() if lic["key"] != license_key]
    _save_licenses(licenses)


def _cache_fresh(lic: dict) -> bool:
    """Cache usable offline only when server-verified within TTL."""
    if lic.get("revoked"):
        return False
    verified = _parse_expiry(lic.get("verified_at"))
    if verified is None:
        return False
    ttl_days = float(os.getenv("LICENSE_CACHE_TTL_DAYS", "7"))
    return (_utcnow() - verified).total_seconds() < ttl_days * 86400


def verify_key(license_key: str, hardware_id: str) -> dict:
    cached = _find_cached(license_key)

    # 1) Remote admin panel is authoritative — always verify when reachable.
    remote = _verify_remote(license_key, hardware_id)
    if remote is not None:
        if remote.get("valid"):
            _cache_remote_license(remote, license_key, hardware_id)
            return {
                "valid": True,
                "expiry": remote.get("expiry"),
                "features": remote.get("features") or ["all"],
            }
        # Revoked / expired / invalid — never fall back to stale cache.
        _drop_cached(license_key)
        return {"valid": False, "reason": remote.get("reason", "Invalid license key")}

    # 2) Fallback: direct MongoDB (admin-generated keys, dev only)
    col = _get_mongo_collection()
    if col is not None:
        try:
            doc = col.find_one({"key": license_key})
            if doc:
                if doc.get("revoked"):
                    return {"valid": False, "reason": "License revoked"}
                doc_expiry = _parse_expiry(doc.get("expiry"))
                if doc_expiry is not None and doc_expiry < _utcnow():
                    return {"valid": False, "reason": "License expired"}
                hw_ids = doc.get("hardwareIds") or []
                max_act = doc.get("maxActivations", 1)
                act_count = doc.get("activationCount", 0)
                if hardware_id not in hw_ids and act_count >= max_act:
                    return {"valid": False, "reason": "License already activated on another device"}
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
        except Exception as e:
            logger.warning(f"MongoDB license check failed: {e}")

    # 3) Server unreachable — offline grace only from a fresh server-verified cache.
    if cached is not None and _cache_fresh(cached):
        expiry = _parse_expiry(cached.get("expiry"))
        if expiry is not None and expiry < _utcnow():
            return {"valid": False, "reason": "License expired", "offline": True}
        hw_ids = cached.get("hardware_ids", [])
        max_act = cached.get("max_activations", 1)
        if hardware_id not in hw_ids and len(hw_ids) >= max_act:
            return {"valid": False, "reason": "License already activated on another device", "offline": True}
        if hardware_id not in hw_ids:
            licenses = _load_licenses()
            for lic in licenses:
                if lic["key"] == license_key:
                    lic.setdefault("hardware_ids", []).append(hardware_id)
                    break
            _save_licenses(licenses)
        return {
            "valid": True,
            "expiry": cached.get("expiry"),
            "features": cached.get("features", ["all"]),
            "offline": True,
        }

    # Stale or missing cache and server unreachable — never grant unverified access.
    return {"valid": False, "reason": "License server unreachable — could not verify key", "offline": True}


def generate_key(expiry_days: int = 365, features: list[str] | None = None) -> dict:
    key = f"WOX-{uuid.uuid4().hex[:12].upper()}"
    record = {
        "key": key,
        "expiry": (_utcnow() + timedelta(days=expiry_days)).isoformat(),
        "features": features or ["all"],
        "hardware_ids": [],
        "max_activations": 1,
        "revoked": False,
        "created_at": _utcnow().isoformat(),
    }
    licenses = _load_licenses()
    licenses.append(record)
    _save_licenses(licenses)
    return record
