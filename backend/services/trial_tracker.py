import json
import logging
import httpx
from datetime import datetime

from ..paths import woxus_data_dir
from ..config import load_config

logger = logging.getLogger(__name__)

DATA_DIR = woxus_data_dir()
TRIAL_FILE = DATA_DIR / "trials.json"
TRIAL_DURATION_SECONDS = 600

def _get_api_base() -> str:
    return load_config().get("LICENSE_SERVER_URL", "https://woxus-a.vercel.app").rstrip("/")

def _get_trial_duration_from_api() -> int:
    try:
        url = f"{_get_api_base()}/api/public/config"
        res = httpx.get(url, timeout=5.0)
        res.raise_for_status()
        return res.json().get("trial_duration_seconds", TRIAL_DURATION_SECONDS)
    except Exception as e:
        logger.warning(f"Could not read trial duration from API: {e}")
    return TRIAL_DURATION_SECONDS

def _register_trial_with_api(hardware_id: str, email: str | None, device_info: str | None, total_seconds: int) -> dict | None:
    try:
        url = f"{_get_api_base()}/api/public/trial"
        payload = {
            "hardwareId": hardware_id,
            "email": email or "",
            "deviceInfo": device_info or "",
            "trialDurationSeconds": total_seconds
        }
        res = httpx.post(url, json=payload, timeout=5.0)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        logger.warning(f"Could not register trial with API: {e}")
    return None


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

def _parse_dt(value: str | None) -> datetime | None:
    """Parse ISO datetime from server (handles trailing Z) or local naive stamp."""
    if not value:
        return None
    try:
        s = value.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None

def get_configured_duration() -> int:
    """Current global trial duration in seconds (admin API, fallback default)."""
    return _get_trial_duration_from_api()

def start_trial(hardware_id: str, device_info: str | None = None, email: str | None = None) -> dict:
    logger.info(f"[TrialTracker] start_trial called for hwid={hardware_id}")
    trials = _load_trials()
    total_seconds = _get_trial_duration_from_api()

    # If the user already has a trial in trials.json, re-sync with the server
    # when reachable so admin changes (duration edit, trial reset) propagate
    # to devices. Offline → local calculation as before.
    if hardware_id in trials:
        existing = trials[hardware_id]
        api_res = _register_trial_with_api(hardware_id, email, device_info, existing["total_seconds"])
        if api_res and api_res.get("exists"):
            if not api_res.get("active"):
                return {
                    "active": False,
                    "remaining_seconds": 0,
                    "total_seconds": api_res.get("total_seconds", existing["total_seconds"]),
                    "email": api_res.get("email", existing.get("email")),
                }
            srv_total = api_res.get("total_seconds") or existing["total_seconds"]
            srv_started = _parse_dt(api_res.get("trial_started_at"))
            loc_started = _parse_dt(existing["started_at"])
            if srv_started and (loc_started is None or srv_started > loc_started):
                # Admin reset the trial clock — adopt server start + duration.
                existing["started_at"] = srv_started.isoformat()
            existing["total_seconds"] = srv_total
            if email:
                existing["email"] = email
            _save_trials(trials)
        started = _parse_dt(existing["started_at"]) or datetime.utcnow()
        elapsed = (datetime.utcnow() - started).total_seconds()
        remaining = max(0, existing["total_seconds"] - elapsed)
        
        logger.info(f"[TrialTracker] Found existing trial in local trials.json. Elapsed: {elapsed}s, Remaining: {remaining}s")

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

    # Otherwise, register with the API
    api_res = _register_trial_with_api(hardware_id, email, device_info, total_seconds)
    
    if api_res and api_res.get("exists"):
        if not api_res.get("active"):
            return {
                "active": False,
                "remaining_seconds": 0,
                "total_seconds": api_res.get("total_seconds", total_seconds),
                "email": api_res.get("email"),
            }
        total_seconds = api_res.get("total_seconds", total_seconds)
    
    # Save the new trial to trials.json
    record = {
        "hardware_id": hardware_id,
        "device_info": device_info or "",
        "email": email or "",
        "started_at": datetime.utcnow().isoformat(),
        "total_seconds": total_seconds,
    }
    trials[hardware_id] = record
    _save_trials(trials)

    return {
        "active": True,
        "remaining_seconds": total_seconds,
        "total_seconds": total_seconds,
        "email": record.get("email"),
    }

def get_trial_status(hardware_id: str) -> dict:
    logger.info(f"[TrialTracker] get_trial_status called for hwid={hardware_id}")
    trials = _load_trials()
    if hardware_id not in trials:
        logger.info(f"[TrialTracker] No trial found in local trials.json for hwid={hardware_id}")
        total_seconds = _get_trial_duration_from_api()
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
    
    logger.info(f"[TrialTracker] Local trial check. Elapsed: {elapsed}s, Remaining: {remaining}s")
    
    return {
        "active": remaining > 0,
        "remaining_seconds": int(remaining),
        "total_seconds": rec["total_seconds"],
        "email": rec.get("email"),
    }
