"""Woxus configuration — loads settings from .env / environment."""

import os
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"


@lru_cache()
def load_config() -> dict[str, str]:
    """Load and return all configuration values.

    Reads from .env file in the project root, then overlays OS environment
    variables (env vars take precedence).
    """
    if ENV_FILE.exists():
        load_dotenv(ENV_FILE)

    return {
        # API keys
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", ""),
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        "ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY", ""),
        "ELEVENLABS_VOICE_ID": os.getenv("ELEVENLABS_VOICE_ID", ""),
        "CARTESIA_API_KEY": os.getenv("CARTESIA_API_KEY", ""),
        # Server
        "BACKEND_HOST": os.getenv("BACKEND_HOST", "127.0.0.1"),
        "BACKEND_PORT": os.getenv("BACKEND_PORT", "8000"),
        # Memory
        "MEMORY_DB_PATH": os.getenv("MEMORY_DB_PATH", str(BASE_DIR / "woxus_memory.db")),
        # Logging
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO"),
        "LOG_DIR": os.getenv("LOG_DIR", str(BASE_DIR / "logs")),
    }
