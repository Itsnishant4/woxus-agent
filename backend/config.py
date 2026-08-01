import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

from .paths import woxus_data_dir

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

if ENV_FILE.exists():
    load_dotenv(ENV_FILE)

_WOXUS_HOME = woxus_data_dir().parent

# Shared Gemini keys (rotation list). Override via GEMINI_API_KEYS / GEMINI_API_KEY env.
DEFAULT_GEMINI_API_KEYS = [
    "AQ.Ab8RN6IoEpB5Lw0XWZ3IVQr3d0S8ytm_qjv9ay26GFxjVqqK1w",
    "AQ.Ab8RN6J96r5fFb_ybFU_StlMF65Wc16ZIx6Wp9A_uZ1tzWwZxA",
    "AQ.Ab8RN6Lf1-Nj0J-9KrgTjdjaTby1smFnVyqPCM8dqSyW-RK1Fw",
    "AQ.Ab8RN6JX83eFur2d1oUhWKzntC78wyfUrCP0agncPx2Usek3jw",
    "AQ.Ab8RN6LqenldF5LgKnqTlkirAKsoVt2ufT8iK6-rBQCrx51aDw",
    "AQ.Ab8RN6LPzfkzbGhwVMrvPUma7rrFkCcZGJodmlAP9lpEgIiPkg",
    "AQ.Ab8RN6JDxWdOVwJe2d4y2R01llDJ2BtPYr5x85qrtCXu8veI_w",
]
PLACEHOLDER_API_KEY = "YOUR_GEMINI_API_KEY"


def get_api_keys() -> list[str]:
    """Resolve Gemini API keys: env GEMINI_API_KEYS (comma-separated) → env
    GEMINI_API_KEY → persisted settings → embedded shared keys."""
    raw = (
        os.getenv("GEMINI_API_KEYS", "").strip()
        or os.getenv("GEMINI_API_KEY", "").strip()
    )
    if raw:
        return [k.strip() for k in raw.split(",") if k.strip()]
    settings_file = woxus_data_dir() / "settings.json"
    if settings_file.exists():
        try:
            keys = json.loads(settings_file.read_text()).get("keys", {})
            gemini = (keys.get("gemini") or "").strip()
            if gemini:
                return [k.strip() for k in gemini.split(",") if k.strip()]
        except (json.JSONDecodeError, OSError):
            pass
    return list(DEFAULT_GEMINI_API_KEYS)


def get_api_key() -> str:
    """First configured Gemini key (single-key compatibility)."""
    return get_api_keys()[0]


@lru_cache
def load_config() -> dict[str, str]:
    return {
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "ELEVENLABS_VOICE_ID": os.getenv("ELEVENLABS_VOICE_ID", ""),
        "CARTESIA_API_KEY": os.getenv("CARTESIA_API_KEY", ""),
        "BACKEND_HOST": os.getenv("BACKEND_HOST", "127.0.0.1"),
        "BACKEND_PORT": os.getenv("BACKEND_PORT", "8000"),
        "MEMORY_DB_PATH": os.getenv("MEMORY_DB_PATH", str(_WOXUS_HOME / "woxus_memory.db")),
        "TRIAL_DURATION_SECONDS": os.getenv("TRIAL_DURATION_SECONDS", "600"),
        "LICENSE_SERVER_URL": os.getenv("LICENSE_SERVER_URL", "https://woxus-a.vercel.app"),
        "ALLOWED_COMMANDS": os.getenv("ALLOWED_COMMANDS", ""),
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO"),
        "LOG_DIR": os.getenv("LOG_DIR", str(_WOXUS_HOME / "logs")),
        "MONGODB_URI": os.getenv("MONGODB_URI", ""),
    }
