"""Woxus — wacli WhatsApp wrapper.

Uses openclaw/wacli (whatsmeow linked device):
  wacli auth --qr-format text --events
  wacli auth status --json
  wacli auth logout
  wacli send text --to RECIPIENT --message TEXT

Single-instance safe: one pair proc at a time.
sent:true = accepted by WhatsApp, not delivered.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from ..paths import woxus_data_dir
from . import whatsapp_contacts

logger = logging.getLogger(__name__)

DATA_DIR = woxus_data_dir()
HISTORY_FILE = DATA_DIR / "whatsapp_history.json"
BIN_DIR = Path.home() / ".woxus" / "bin"
WACLI_ACCOUNT = os.getenv("WOXUS_WACLI_ACCOUNT", "woxus")

_lock = threading.Lock()
_pair_proc: subprocess.Popen | None = None
_pair_qr: str = ""
_pair_status: str = "idle"  # idle|waiting|paired|expired|error|cancelled
_pair_error: str = ""
_pair_started_at: float = 0.0


def _wacli_bin() -> str | None:
    override = os.getenv("WACLI_PATH", "").strip()
    if override and Path(override).exists():
        return override
    local = BIN_DIR / ("wacli.exe" if os.name == "nt" else "wacli")
    if local.exists():
        return str(local)
    found = shutil.which("wacli")
    return found


def is_installed() -> bool:
    return _wacli_bin() is not None


def _base_args(extra_account: bool = True) -> list[str]:
    bin_path = _wacli_bin()
    if not bin_path:
        return []
    args = [bin_path]
    if extra_account and WACLI_ACCOUNT:
        args += ["--account", WACLI_ACCOUNT]
    return args


def _run(args: list[str], timeout: int = 30) -> dict:
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return {"returncode": proc.returncode, "stdout": proc.stdout or "", "stderr": proc.stderr or ""}
    except subprocess.TimeoutExpired as e:
        return {"returncode": 124, "stdout": "", "stderr": f"timeout after {timeout}s: {e}"}
    except Exception as e:
        return {"returncode": 1, "stdout": "", "stderr": str(e)}


def get_status() -> dict:
    bin_path = _wacli_bin()
    if not bin_path:
        return {"installed": False, "paired": False, "status": "not_installed", "hint": "Install wacli (github.com/openclaw/wacli) or set WACLI_PATH, then Pair in Settings."}
    base = _base_args()
    # auth status --json preferred, fallback plain
    res = _run(base + ["auth", "status", "--json"], timeout=15)
    out = (res.get("stdout") or "").strip()
    if out:
        try:
            payload = json.loads(out)
            paired = bool(payload.get("authenticated", payload.get("paired", False)))
            return {"installed": True, "paired": paired, "status": "paired" if paired else "not_logged_in", "raw": payload}
        except Exception:
            pass
    combined = ((res.get("stdout") or "") + "\n" + (res.get("stderr") or "")).lower()
    if "not authenticated" in combined or "run wacli auth" in combined or res.get("returncode") != 0:
        # try plain status for message
        return {"installed": True, "paired": False, "status": "not_logged_in", "detail": (res.get("stderr") or res.get("stdout") or "").strip()[:500]}
    # heuristic: exit 0 without json -> assume paired if no negative keywords
    paired = "authenticated" in combined or "logged in" in combined or res.get("returncode") == 0
    return {"installed": True, "paired": paired, "status": "paired" if paired else "not_logged_in"}


def _append_history(entry: dict):
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        hist = []
        if HISTORY_FILE.exists():
            try:
                hist = json.loads(HISTORY_FILE.read_text())
            except Exception:
                hist = []
        entry["at"] = datetime.utcnow().isoformat()
        hist.append(entry)
        HISTORY_FILE.write_text(json.dumps(hist[-200:], indent=2))
    except Exception as e:
        logger.warning("whatsapp history append failed: %s", e)


def send_text(to: str, message: str) -> dict:
    bin_path = _wacli_bin()
    if not bin_path:
        return {"error": "wacli not installed. Install wacli then Pair in Settings.", "code": "not_installed"}
    msg = (message or "").strip()
    if not msg:
        return {"error": "Empty message — nothing to send.", "code": "empty"}
    if len(msg) > 4096:
        return {"error": "Message too long (>4096 chars). Shorten it.", "code": "too_long"}
    st = get_status()
    if not st.get("paired"):
        return {"error": "WhatsApp not linked. Open Settings → WhatsApp → scan QR.", "code": "needs_login"}

    args = _base_args() + ["send", "text", "--to", to, "--message", msg]
    # run off-thread if called from async context? caller uses to_thread
    res = _run(args, timeout=45)
    stdout = res.get("stdout", "")
    stderr = res.get("stderr", "")
    combined = stdout + "\n" + stderr

    # rapid-send guardrail visible
    rate_warned = "within 5 seconds" in combined.lower() or "rate-limit" in combined.lower()

    # success heuristics: "Sent to" / JSON sent:true / message ID
    m_id = None
    m = re.search(r"[\"']?id[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9._-]{6,})", combined)
    if m:
        m_id = m.group(1)[:120]
    ok = res.get("returncode") == 0 and ("sent to" in combined.lower() or '"sent":true' in combined.lower() or "sent: true" in combined.lower() or "sent:" in combined.lower())

    # store_warning still means delivered
    store_warn = "store_warning" in combined.lower() or "recording it in local history fails" in combined.lower()
    if res.get("returncode") == 0 and (ok or store_warn or "sent" in combined.lower()):
        _append_history({"to": to, "message": msg[:500], "result": "sent", "id": m_id, "rate_warned": rate_warned})
        out: dict = {"status": "sent", "to": to, "id": m_id, "message": "WhatsApp accepted the message (sent:true means accepted, not delivered)."}
        if store_warn:
            out["warning"] = "Delivered but local history record failed — do NOT retry."
        if rate_warned:
            out["warning"] = (out.get("warning", "") + " Rapid-send guardrail hit — slow down.").strip()
        return out

    # ambiguous name
    if "ambiguous" in combined.lower() or "pick" in combined.lower():
        return {"error": f"Ambiguous recipient. {combined.strip()[:600]}", "code": "ambiguous", "detail": combined.strip()[:1000]}
    _append_history({"to": to, "message": msg[:500], "result": "failed", "detail": combined.strip()[:500]})
    return {"error": (stderr.strip() or stdout.strip() or "Send failed")[:800], "code": "send_failed"}


def sync_contacts_cache() -> dict:
    """Best-effort refresh of name->jid cache via wacli contacts. Never fails hard."""
    bin_path = _wacli_bin()
    if not bin_path:
        return {"ok": False, "reason": "not_installed"}
    for cmd in (["contacts", "list", "--json"], ["contacts", "--json"], ["chats", "list", "--json"]):
        res = _run(_base_args() + cmd, timeout=20)
        out = (res.get("stdout") or "").strip()
        if not out or res.get("returncode") != 0:
            continue
        try:
            payload = json.loads(out)
            items = payload if isinstance(payload, list) else payload.get("contacts", payload.get("chats", []))
            cache = {}
            for it in items if isinstance(items, list) else []:
                name = str(it.get("name", it.get("push_name", it.get("title", "")))).strip()
                jid = str(it.get("jid", it.get("phone", it.get("id", "")))).strip()
                if name and jid:
                    cache[name] = jid
            if cache:
                whatsapp_contacts.save_cached_contacts(cache)
                return {"ok": True, "count": len(cache)}
        except Exception:
            continue
    return {"ok": False, "reason": "no parseable contacts output"}


# --- Pair / QR session ---

def pair_start() -> dict:
    global _pair_proc, _pair_qr, _pair_status, _pair_error, _pair_started_at
    with _lock:
        if _pair_proc and _pair_proc.poll() is None:
            return {"status": _pair_status, "qr_text": _pair_qr, "note": "pair already running"}
        bin_path = _wacli_bin()
        if not bin_path:
            return {"status": "error", "error": "wacli not installed"}
        _pair_qr = ""
        _pair_error = ""
        _pair_status = "waiting"
        _pair_started_at = time.time()
        try:
            _pair_proc = subprocess.Popen(
                [bin_path] + (["--account", WACLI_ACCOUNT] if WACLI_ACCOUNT else []) + ["auth", "--qr-format", "text", "--events"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except Exception as e:
            _pair_status = "error"
            _pair_error = str(e)
            return {"status": "error", "error": str(e)}
    threading.Thread(target=_pair_watcher, daemon=True).start()
    return {"status": "waiting", "hint": "Scan QR in WhatsApp → Linked devices. Poll /pair/qr."}


def _pair_watcher():
    global _pair_proc, _pair_qr, _pair_status, _pair_error
    assert _pair_proc is not None
    proc = _pair_proc
    try:
        # read both streams line-wise; QR payload lines are long alnum blobs
        import selectors

        # simple poll loop: non-blocking readline with timeout
        start = time.time()
        while proc.poll() is None and time.time() - start < 180:
            line = ""
            try:
                import select

                # stdout first
                if proc.stdout and select.select([proc.stdout], [], [], 0.5)[0]:
                    line = proc.stdout.readline() or ""
                elif proc.stderr and select.select([proc.stderr], [], [], 0.2)[0]:
                    line = proc.stderr.readline() or ""
                else:
                    time.sleep(0.3)
                    continue
            except Exception:
                time.sleep(0.3)
                continue
            t = line.strip()
            if not t:
                continue
            # NDJSON event with qr?
            if t.startswith("{"):
                try:
                    ev = json.loads(t)
                    qr = ev.get("qr", ev.get("qr_text", ev.get("code", "")))
                    if qr:
                        _pair_qr = str(qr)
                    if ev.get("type", "").lower() in ("paired", "authenticated", "success"):
                        _pair_status = "paired"
                        break
                    continue
                except Exception:
                    pass
            # raw QR payload heuristic: long string, little spaces
            if len(t) > 40 and " " not in t.strip()[:60]:
                _pair_qr = t
            if "paired" in t.lower() or "authenticated" in t.lower() or "bootstrap sync" in t.lower():
                _pair_status = "paired"
            if "expired" in t.lower() or "invalid qr" in t.lower():
                _pair_status = "expired"
                _pair_error = t[:300]
        if proc.poll() is None:
            # timed out waiting
            pass
        else:
            rc = proc.poll()
            if _pair_status == "waiting":
                _pair_status = "paired" if rc == 0 else "error"
                if rc != 0:
                    try:
                        err = proc.stderr.read() if proc.stderr else ""  # type: ignore
                        _pair_error = (err or "")[:500]
                    except Exception:
                        pass
    except Exception as e:
        _pair_status = "error"
        _pair_error = str(e)[:500]


def pair_qr() -> dict:
    with _lock:
        proc_running = _pair_proc is not None and _pair_proc.poll() is None
    st = get_status()
    if st.get("paired"):
        return {"status": "paired", "qr_text": "", "paired": True}
    return {
        "status": _pair_status,
        "qr_text": _pair_qr,
        "error": _pair_error,
        "running": proc_running,
        "elapsed": round(time.time() - _pair_started_at, 1) if _pair_started_at else 0,
    }


def pair_cancel() -> dict:
    global _pair_proc, _pair_status
    with _lock:
        if _pair_proc and _pair_proc.poll() is None:
            try:
                _pair_proc.terminate()
            except Exception:
                pass
        _pair_proc = None
        _pair_status = "cancelled"
        return {"status": "cancelled"}


def logout() -> dict:
    res = _run(_base_args() + ["auth", "logout"], timeout=20)
    if res.get("returncode") == 0:
        return {"status": "logged_out"}
    return {"status": "error", "error": (res.get("stderr") or res.get("stdout") or "logout failed")[:500]}


async def send_text_async(to: str, message: str) -> dict:
    return await asyncio.to_thread(send_text, to, message)
