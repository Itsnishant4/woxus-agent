import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from ..paths import woxus_data_dir

logger = logging.getLogger(__name__)

DATA_DIR = woxus_data_dir()
MEMORY_FILE = DATA_DIR / "memories.json"


def _ensure_store():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not MEMORY_FILE.exists():
        MEMORY_FILE.write_text("[]")


def _load() -> list[dict]:
    _ensure_store()
    try:
        return json.loads(MEMORY_FILE.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _save(memories: list[dict]):
    MEMORY_FILE.write_text(json.dumps(memories, indent=2, default=str))


def list_memories(category: str | None = None) -> list[dict]:
    mems = _load()
    if category:
        mems = [m for m in mems if m.get("category") == category]
    return sorted(mems, key=lambda m: m.get("importance", 0), reverse=True)


def search_memories(query: str) -> list[dict]:
    mems = _load()
    q_words = set(query.lower().split())
    results = []
    for m in mems:
        content = m.get("content", "").lower()
        category = m.get("category", "").lower()
        # Match if any query word appears in content or category
        if any(w in content or w in category for w in q_words):
            results.append(m)
    return results


def create_memory(category: str, content: str, importance: float = 0.5) -> dict:
    mem = {
        "id": uuid.uuid4().hex[:16],
        "category": category,
        "content": content,
        "importance": importance,
        "active": True,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    mems = _load()
    mems.append(mem)
    _save(mems)
    return mem


def update_memory(memory_id: str, updates: dict) -> dict | None:
    mems = _load()
    for m in mems:
        if m["id"] == memory_id:
            for key in ("content", "importance", "active"):
                if key in updates and updates[key] is not None:
                    m[key] = updates[key]
            m["updated_at"] = datetime.utcnow().isoformat()
            _save(mems)
            return m
    return None


def delete_memory(memory_id: str) -> bool:
    mems = _load()
    filtered = [m for m in mems if m["id"] != memory_id]
    if len(filtered) == len(mems):
        return False
    _save(filtered)
    return True
