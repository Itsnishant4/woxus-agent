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


def get_api_keys() -> list[str]:
    """Resolve Gemini API keys: env GEMINI_API_KEYS (comma-separated) → env
    GEMINI_API_KEY → persisted settings. Never falls back to embedded keys —
    keys must come from env or the settings file (populated from the admin API)."""
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
    return []


def get_api_key() -> str:
    """First configured Gemini key (single-key compatibility). Empty when none."""
    keys = get_api_keys()
    return keys[0] if keys else ""


@lru_cache
def load_config() -> dict[str, str]:
    return {
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "ELEVENLABS_VOICE_ID": os.getenv("ELEVENLABS_VOICE_ID", ""),
        "CARTESIA_API_KEY": os.getenv("CARTESIA_API_KEY", ""),
        "BACKEND_HOST": os.getenv("BACKEND_HOST", "127.0.0.1"),
        "BACKEND_PORT": os.getenv("BACKEND_PORT", "8457"),
        "MEMORY_DB_PATH": os.getenv("MEMORY_DB_PATH", str(_WOXUS_HOME / "woxus_memory.db")),
        "TRIAL_DURATION_SECONDS": os.getenv("TRIAL_DURATION_SECONDS", "600"),
        "LICENSE_SERVER_URL": os.getenv("LICENSE_SERVER_URL", "https://woxus-a.vercel.app"),
        "ALLOWED_COMMANDS": os.getenv("ALLOWED_COMMANDS", ""),
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO"),
        "LOG_DIR": os.getenv("LOG_DIR", str(_WOXUS_HOME / "logs")),
        "MONGODB_URI": os.getenv("MONGODB_URI", ""),
        "MAX_PARALLEL_MINI_TASKS": os.getenv("MAX_PARALLEL_MINI_TASKS", "10"),
    }
