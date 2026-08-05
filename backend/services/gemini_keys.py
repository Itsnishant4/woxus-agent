import asyncio
import json
import logging
import os
import time
import urllib.parse
import urllib.request

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
    """Offline resolution: env → persisted settings (populated from the admin
    API). Never embedded static keys."""
    return _env_keys() or _persisted_keys()


def _get_saved_license_info() -> tuple[str | None, str | None]:
    """Auto-resolve license key and hardware ID from local persisted stores."""
    lic_file = woxus_data_dir() / "licenses.json"
    lic_key, hw_id = None, None
    try:
        if lic_file.exists():
            data = json.loads(lic_file.read_text())
            if isinstance(data, list) and data:
                for item in reversed(data):
                    if item.get("key") and not item.get("revoked"):
                        lic_key = item.get("key")
                        hw_ids = item.get("hardware_ids") or []
                        if hw_ids:
                            hw_id = hw_ids[0]
                        break
    except Exception:
        pass

    if not hw_id:
        trial_file = woxus_data_dir() / "trials.json"
        try:
            if trial_file.exists():
                trials = json.loads(trial_file.read_text())
                if isinstance(trials, dict) and trials:
                    hw_id = next(iter(trials.keys()))
        except Exception:
            pass

    return lic_key, hw_id


def fetch_admin_gemini_keys(license_key: str | None, hardware_id: str | None) -> list[str] | None:
    """Fetch the admin-managed key pool.

    Supports license_key + hardware_id or hardware_id alone (for trial mode).
    Returns None on any failure so the caller falls back to local keys.
    """
    server = os.getenv("LICENSE_SERVER_URL", "https://woxus-a.vercel.app").rstrip("/")
    if not server:
        return None
    params = {}
    if license_key and license_key.strip():
        params["license_key"] = license_key.strip()
    if hardware_id and hardware_id.strip():
        params["hardware_id"] = hardware_id.strip()
    if not params:
        return None
    url = f"{server}/api/gemini-keys?" + urllib.parse.urlencode(params)
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


async def refresh_gemini_api_keys(
    license_key: str | None,
    hardware_id: str | None,
    force_refresh: bool = False,
) -> list[str]:
    """Resolve the key pool for a voice session.

    Priority: env override → admin-managed pool (license-gated, TTL-cached,
    also persisted locally) → persisted settings → embedded shared keys.

    force_refresh bypasses the TTL cache so a session that exhausted its pool
    pulls a genuinely fresh set from the admin API instead of the stale copy.
    """
    global _cache, _cache_at
    env = _env_keys()
    if env and not force_refresh:
        return env
    if not force_refresh and _cache and time.monotonic() - _cache_at < CACHE_TTL_SECONDS:
        return list(_cache)
    if force_refresh:
        _cache, _cache_at = None, 0.0

    if not license_key or not hardware_id:
        saved_lic, saved_hw = _get_saved_license_info()
        license_key = license_key or saved_lic
        hardware_id = hardware_id or saved_hw

    if license_key or hardware_id:
        # Run the blocking urllib fetch off the event loop so a slow/unreachable
        # admin panel can't stall other async requests.
        admin = await asyncio.to_thread(fetch_admin_gemini_keys, license_key, hardware_id)
        if admin:
            logger.info("Using admin-managed Gemini key pool (%d keys)", len(admin))
            _cache, _cache_at = list(admin), time.monotonic()
            return admin
    return local_gemini_keys()
