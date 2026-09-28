"""Woxus — WhatsApp contact NLP resolver.

Voice gives raw `to_raw` ("mom", "Mum", "Rahul Sharma").
This resolves to nearest known person with score.
No invention: unknown -> clarify.
"""

import json
import logging
import re
from difflib import SequenceMatcher

from ..paths import woxus_data_dir

logger = logging.getLogger(__name__)

SETTINGS_FILE = woxus_data_dir() / "settings.json"
CACHE_FILE = woxus_data_dir() / "whatsapp_contacts_cache.json"

AUTO_THRESHOLD = 75
SUGGEST_THRESHOLD = 55


def _normalize(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def _is_phone(to_raw: str) -> str | None:
    digits = re.sub(r"[^\d+]", "", (to_raw or "").strip())
    if not digits:
        return None
    if digits.startswith("+"):
        if re.fullmatch(r"\+\d{8,15}", digits):
            return digits
        return None
    # bare digits with optional country handling
    d = re.sub(r"\D", "", digits)
    if 8 <= len(d) <= 15:
        default_cc = _default_country()
        if not digits.startswith("0") and default_cc and len(d) <= 10:
            return default_cc + d.lstrip("0")
        if len(d) > 10:
            return "+" + d
        # return as-is with + when length plausible, else None
        if len(d) >= 8:
            return "+" + d if not digits.startswith("+") else digits
    return None


def _default_country() -> str:
    try:
        if SETTINGS_FILE.exists():
            data = json.loads(SETTINGS_FILE.read_text())
            cc = str(data.get("whatsapp_default_country", "")).strip()
            if cc and not cc.startswith("+"):
                cc = "+" + cc
            return cc
    except Exception:
        pass
    return ""


def _local_contacts() -> dict[str, str]:
    try:
        if SETTINGS_FILE.exists():
            data = json.loads(SETTINGS_FILE.read_text())
            c = data.get("whatsapp_contacts", {}) or {}
            return {str(k): str(v) for k, v in c.items() if k and v}
    except Exception:
        pass
    return {}


def _cached_wacli_contacts() -> dict[str, str]:
    try:
        if CACHE_FILE.exists():
            data = json.loads(CACHE_FILE.read_text())
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _score(a: str, b: str) -> float:
    """0-100 fuzzy score. rapidfuzz when available, else difflib."""
    a_n, b_n = _normalize(a), _normalize(b)
    if not a_n or not b_n:
        return 0.0
    if a_n == b_n:
        return 100.0
    try:
        from rapidfuzz import fuzz  # type: ignore

        s1 = fuzz.token_set_ratio(a_n, b_n)
        s2 = fuzz.partial_ratio(a_n, b_n)
        return round((s1 * 0.7 + s2 * 0.3), 1)
    except Exception:
        # difflib fallback
        r = SequenceMatcher(None, a_n, b_n).ratio() * 100
        # bonus for substring
        if a_n in b_n or b_n in a_n:
            r = max(r, 80.0)
        return round(r, 1)


def save_cached_contacts(contacts: dict[str, str]):
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(contacts, indent=2))
    except Exception as e:
        logger.warning("whatsapp contacts cache save failed: %s", e)


def resolve_contact(to_raw: str) -> dict:
    """Resolve voice recipient to nearest person.

    Returns dict with status: exact|fuzzy|phone|ambiguous|unknown|needs_login_hint never here.
    """
    raw = (to_raw or "").strip()
    if not raw:
        return {"status": "unknown", "to_raw": to_raw, "score": 0}

    phone = _is_phone(raw)
    if phone:
        return {
            "status": "phone",
            "to_raw": to_raw,
            "matched": phone,
            "phone": phone,
            "score": 100.0,
        }

    pool: dict[str, str] = {}
    pool.update(_cached_wacli_contacts())
    # local contacts override (user-curated)
    pool.update(_local_contacts())

    if not pool:
        return {"status": "unknown", "to_raw": to_raw, "score": 0, "reason": "no contacts yet, sync or add in Settings"}

    scored = []
    for name, phone_or_jid in pool.items():
        s = _score(raw, name)
        scored.append({"name": name, "phone": phone_or_jid, "score": s})
    scored.sort(key=lambda x: x["score"], reverse=True)

    top = scored[0]
    if top["score"] >= AUTO_THRESHOLD:
        return {
            "status": "fuzzy" if top["score"] < 100 else "exact",
            "to_raw": to_raw,
            "matched": top["name"],
            "phone": top["phone"],
            "score": top["score"],
            "alternatives": scored[1:3],
        }
    if top["score"] >= SUGGEST_THRESHOLD:
        return {
            "status": "ambiguous",
            "to_raw": to_raw,
            "score": top["score"],
            "candidates": scored[:3],
        }
    return {"status": "unknown", "to_raw": to_raw, "score": top["score"], "candidates": scored[:3]}
