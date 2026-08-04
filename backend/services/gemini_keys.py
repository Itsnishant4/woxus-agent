import asyncio
import json
import logging
import os
import time
import urllib.parse
import urllib.request

from ..config import DEFAULT_GEMINI_API_KEYS
from ..paths import woxus_data_dir

logger = logging.getLogger(__name__)

KEYS_FETCH_TIMEOUT_SECONDS = 8
CACHE_TTL_SECONDS = 3600
SETTINGS_FILE = woxus_data_dir() / "settings.json"

# In-memory TTL cache so we don't hit the admin panel on every voice session.
_cache: list[str] | None = None
_cache_at: float = 0.0


def _env_keys() -> list[str] | None:
    """GEMINI_API_KEYS (comma-separated) → GEMINI_API_KEY. None when unset."""
    raw = (
        os.getenv("GEMINI_API_KEYS", "").strip()
        or os.getenv("GEMINI_API_KEY", "").strip()
    )
    if not raw:
        return None
    return [k.strip() for k in raw.split(",") if k.strip()]


def _persisted_keys() -> list[str]:
    """Keys cached locally in settings.json (from a past admin fetch or manual entry)."""
    try:
        if SETTINGS_FILE.exists():
            data = json.loads(SETTINGS_FILE.read_text())
            gemini = (data.get("keys", {}).get("gemini") or "").strip()
            if gemini:
                return [k.strip() for k in gemini.split(",") if k.strip()]
    except (json.JSONDecodeError, OSError):
        pass
    return []


def _save_persisted_keys(keys: list[str]):
    """Persist the admin-fetched pool so voice works offline / when panel is down."""
    try:
        data = json.loads(SETTINGS_FILE.read_text()) if SETTINGS_FILE.exists() else {}
    except (json.JSONDecodeError, OSError):
        data = {}
    data.setdefault("keys", {})["gemini"] = ",".join(k for k in keys if k.strip())
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def local_gemini_keys() -> list[str]:
    """Offline resolution: env → persisted settings → embedded shared keys."""
    return _env_keys() or _persisted_keys() or list(DEFAULT_GEMINI_API_KEYS)


def fetch_admin_gemini_keys(license_key: str, hardware_id: str) -> list[str] | None:
    """License-gated fetch of the admin-managed key pool.

    Only a valid, non-revoked license whose hardwareId is registered gets the
    pool (the admin panel enforces this). Returns None on any failure so the
    caller falls back to local keys instead of breaking the session.
    """
    server = os.getenv("LICENSE_SERVER_URL", "https://woxus-a.vercel.app").rstrip("/")
    if not server:
        return None
    url = (
        f"{server}/api/gemini-keys?"
        + urllib.parse.urlencode({"license_key": license_key, "hardware_id": hardware_id})
    )
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=KEYS_FETCH_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode())
        keys = [k.strip() for k in payload.get("keys", []) if k.strip()]
        if keys:
            _save_persisted_keys(keys)
            return keys
        logger.warning("Admin key pool is empty")
        return None
    except Exception as e:
        logger.warning("Admin gemini-keys fetch failed (%s); using local keys", e)
        return None


async def refresh_gemini_api_keys(license_key: str | None, hardware_id: str | None) -> list[str]:
    """Resolve the key pool for a voice session.

    Priority: env override → admin-managed pool (license-gated, TTL-cached,
    also persisted locally) → persisted settings → embedded shared keys.
    """
    global _cache, _cache_at
    env = _env_keys()
    if env:
        return env
    if _cache and time.monotonic() - _cache_at < CACHE_TTL_SECONDS:
        return list(_cache)
    if license_key and hardware_id:
        # Run the blocking urllib fetch off the event loop so a slow/unreachable
        # admin panel can't stall other async requests.
        admin = await asyncio.to_thread(fetch_admin_gemini_keys, license_key, hardware_id)
        if admin:
            logger.info("Using admin-managed Gemini key pool (%d keys)", len(admin))
            _cache, _cache_at = list(admin), time.monotonic()
            return admin
    return local_gemini_keys()
