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


@lru_cache()
def load_config() -> dict[str, str]:
    return {
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", ""),
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "ELEVENLABS_VOICE_ID": os.getenv("ELEVENLABS_VOICE_ID", ""),
        "CARTESIA_API_KEY": os.getenv("CARTESIA_API_KEY", ""),
        "BACKEND_HOST": os.getenv("BACKEND_HOST", "127.0.0.1"),
        "BACKEND_PORT": os.getenv("BACKEND_PORT", "8000"),
        "MEMORY_DB_PATH": os.getenv("MEMORY_DB_PATH", str(_WOXUS_HOME / "woxus_memory.db")),
        "TRIAL_DURATION_SECONDS": os.getenv("TRIAL_DURATION_SECONDS", "600"),
        "LICENSE_SERVER_URL": os.getenv("LICENSE_SERVER_URL", "http://localhost:3000"),
        "ALLOWED_COMMANDS": os.getenv("ALLOWED_COMMANDS", ""),
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO"),
        "LOG_DIR": os.getenv("LOG_DIR", str(_WOXUS_HOME / "logs")),
        "MONGODB_URI": os.getenv("MONGODB_URI", ""),
    }
