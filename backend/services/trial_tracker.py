import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TRIAL_FILE = DATA_DIR / "trials.json"
TRIAL_DURATION_SECONDS = 600


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


def start_trial(hardware_id: str, device_info: Optional[str] = None) -> dict:
    trials = _load_trials()

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
            }
        return {
            "active": False,
            "remaining_seconds": 0,
            "total_seconds": existing["total_seconds"],
        }

    record = {
        "hardware_id": hardware_id,
        "device_info": device_info or "",
        "started_at": datetime.utcnow().isoformat(),
        "total_seconds": TRIAL_DURATION_SECONDS,
    }
    trials[hardware_id] = record
    _save_trials(trials)

    return {
        "active": True,
        "remaining_seconds": TRIAL_DURATION_SECONDS,
        "total_seconds": TRIAL_DURATION_SECONDS,
    }


def get_trial_status(hardware_id: str) -> dict:
    trials = _load_trials()
    if hardware_id not in trials:
        return {
            "active": False,
            "remaining_seconds": 0,
            "total_seconds": TRIAL_DURATION_SECONDS,
        }
    rec = trials[hardware_id]
    started = datetime.fromisoformat(rec["started_at"])
    elapsed = (datetime.utcnow() - started).total_seconds()
    remaining = max(0, rec["total_seconds"] - elapsed)
    return {
        "active": remaining > 0,
        "remaining_seconds": int(remaining),
        "total_seconds": rec["total_seconds"],
    }
