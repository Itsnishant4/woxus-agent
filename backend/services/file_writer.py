import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {
    ".md", ".txt", ".json", ".js", ".ts", ".py",
    ".html", ".css", ".jsx", ".tsx", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".env", ".xml", ".csv",
}


def write_file(path: str, content: str) -> dict:
    resolved = Path(path).resolve()

    ext = resolved.suffix.lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        return {"error": f"File extension '{ext}' not allowed"}

    resolved.parent.mkdir(parents=True, exist_ok=True)

    resolved.write_text(content, encoding="utf-8")
    size = resolved.stat().st_size
    logger.info("Wrote %d bytes to %s", size, resolved)

    return {"path": str(resolved), "size": size}


async def read_text_file(path: str) -> str:
    """Read a text file and return its contents."""
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"File not found: {resolved}")
    return resolved.read_text(encoding="utf-8")
