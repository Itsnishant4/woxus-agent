"""Woxus — user-writable path resolution.

Packaged apps must keep all persistent data OUTSIDE the app bundle:
updates replace the app directory and would wipe it otherwise.
"""

import os
from pathlib import Path


def woxus_data_dir() -> Path:
    override = os.getenv("WOXUS_DATA_DIR")
    if override:
        return Path(override)
    return Path.home() / ".woxus" / "data"


def woxus_models_dir() -> Path:
    override = os.getenv("WOXUS_MODELS_DIR")
    if override:
        return Path(override)
    return Path.home() / ".woxus" / "models"
