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
import platform as _platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from ..paths import woxus_data_dir
from . import whatsapp_contacts

logger = logging.getLogger(__name__)

DATA_DIR = woxus_data_dir()
HISTORY_FILE = DATA_DIR / "whatsapp_history.json"
BIN_DIR = Path.home() / ".woxus" / "bin"
WACLI_ACCOUNT = os.getenv("WOXUS_WACLI_ACCOUNT", "").strip()
# Named accounts require `wacli accounts add NAME` first, so default to the
# default store (no --account flag) unless explicitly configured.

_lock = threading.Lock()
_pair_proc: subprocess.Popen | None = None
_pair_qr: str = ""
_pair_code: str = ""
_pair_mode: str = "qr"  # qr | phone
_pair_status: str = "idle"  # idle|waiting|paired|expired|error|cancelled
_pair_error: str = ""
_pair_started_at: float = 0.0

_PAIR_CODE_RE = re.compile(r"^[A-Z0-9]{4}-[A-Z0-9]{4}$|^[A-Z0-9]{8}$")


def _kill_stale_auth_procs():
    """Kill orphaned `wacli auth` processes (e.g. left behind by a backend
    restart). A stale holder keeps the store LOCKED so fresh codes are dead."""
    try:
        r = subprocess.run(["pgrep", "-f", "wacli auth"], capture_output=True, text=True, timeout=5)
    except Exception:
        return
    me = os.getpid()
    killed = False
    for pid_s in (r.stdout or "").split():
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        if pid == me:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            killed = True
            logger.info("[wacli-pair] killed stale auth proc %d", pid)
        except Exception:
            pass
    if killed:
        time.sleep(1.5)  # let the store LOCK release before spawning


def _wacli_bin() -> str | None:
    override = os.getenv("WACLI_PATH", "").strip()
    if override and Path(override).exists():
        return override
    # Bundled binary in packaged app: <resources>/wacli/wacli[.exe], sitting
    # next to the PyInstaller backend dir. Only trusted when frozen so a dev
    # checkout never picks up a stale bundle.
    if getattr(sys, "frozen", False):
        try:
            bundled = Path(sys.executable).resolve().parent.parent / "wacli" / ("wacli.exe" if os.name == "nt" else "wacli")
            if bundled.exists():
                return str(bundled)
        except Exception:
            pass
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


def _parse_auth_payload(payload: object) -> tuple[bool, dict]:
    """Extract (paired, info) from `wacli auth status --json`.

    Shape is nested: {"success": true, "data": {"authenticated": true,
    "linked_jid": "...", "phone": "..."}}. Older builds may be flat.
    """
    if not isinstance(payload, dict):
        return False, {}
    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}
    paired = bool(
        payload.get("authenticated",
            payload.get("paired",
                data.get("authenticated",
                    data.get("paired", False))))
    )
    info = {
        "jid": str(data.get("linked_jid", data.get("jid", "")) or ""),
        "phone": str(data.get("phone", "") or ""),
    }
    return paired, info


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
            paired, info = _parse_auth_payload(payload)
            result: dict = {"installed": True, "paired": paired, "status": "paired" if paired else "not_logged_in", "raw": payload}
            result.update({k: v for k, v in info.items() if v})
            return result
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
    """Best-effort refresh of name->jid cache via wacli. Never fails hard.

    Primary source is `chats list` (DM + group names with JIDs); contacts
    metadata via `contacts search`. Envelope: {"success":..,"data":[...]}.
    """
    bin_path = _wacli_bin()
    if not bin_path:
        return {"ok": False, "reason": "not_installed"}
    cache: dict[str, str] = {}
    for cmd in (["chats", "list", "--json"], ["contacts", "search", "--json", "a"]):
        res = _run(_base_args() + cmd, timeout=20)
        out = (res.get("stdout") or "").strip()
        if not out or res.get("returncode") != 0:
            continue
        try:
            payload = json.loads(out)
        except Exception:
            continue
        items = payload if isinstance(payload, list) else payload.get(
            "data", payload.get("contacts", payload.get("chats", [])))
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name", it.get("push_name", it.get("title", "")))).strip()
            jid = str(it.get("jid", it.get("phone", it.get("id", "")))).strip()
            if name and jid and name != jid:
                cache[name] = jid
    if cache:
        whatsapp_contacts.save_cached_contacts(cache)
        return {"ok": True, "count": len(cache)}
    return {"ok": False, "reason": "no parseable contacts output"}


# --- Pair / QR session ---

def pair_start(phone: str | None = None) -> dict:
    global _pair_proc, _pair_qr, _pair_code, _pair_mode, _pair_status, _pair_error, _pair_started_at
    with _lock:
        if _pair_proc and _pair_proc.poll() is None:
            return {"status": _pair_status, "qr_text": _pair_qr, "pair_code": _pair_code, "mode": _pair_mode, "note": "pair already running"}
        bin_path = _wacli_bin()
        if not bin_path:
            return {"status": "error", "error": "wacli not installed"}
        _kill_stale_auth_procs()
        digits = re.sub(r"\D", "", phone or "")
        use_phone = bool(digits) and 8 <= len(digits) <= 15
        if phone and not use_phone:
            return {"status": "error", "error": "Enter phone in international format, e.g. +919876543210."}
        _pair_qr = ""
        _pair_code = ""
        _pair_mode = "phone" if use_phone else "qr"
        _pair_error = ""
        _pair_status = "waiting"
        _pair_started_at = time.time()
        try:
            args = [bin_path] + (["--account", WACLI_ACCOUNT] if WACLI_ACCOUNT else []) + ["auth", "--events"]
            if use_phone:
                args += ["--phone", "+" + digits]
            else:
                args += ["--qr-format", "text"]
            _pair_proc = subprocess.Popen(
                args,
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
    if use_phone:
        return {"status": "waiting", "mode": "phone", "hint": "Enter the code in WhatsApp → Linked devices → Link with phone number."}
    return {"status": "waiting", "mode": "qr", "hint": "Scan QR in WhatsApp → Linked devices. Poll /pair/qr."}


def _pair_watcher():
    global _pair_proc, _pair_qr, _pair_code, _pair_status, _pair_error
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
            # NDJSON lifecycle events on stderr (qr_code, pair_code, paired…).
            if t.startswith("{"):
                try:
                    ev = json.loads(t)
                except Exception:
                    ev = None
                if isinstance(ev, dict):
                    etype = str(ev.get("event", "")).lower()
                    data = ev.get("data")
                    payload = data.get("code") if isinstance(data, dict) else (data if isinstance(data, str) else "")
                    if etype == "qr_code" and payload:
                        _pair_qr = str(payload)
                    elif etype == "pair_code" and payload:
                        _pair_code = str(payload).upper()
                    elif etype in ("paired", "authenticated", "success", "login_success"):
                        _pair_status = "paired"
                        break
                    elif etype == "error":
                        msg = str(data.get("message", data) if isinstance(data, dict) else data)
                        if "locked" in msg.lower():
                            _pair_status = "error"
                            _pair_error = "WhatsApp store is locked by another pairing — tap Pair again (stale sessions auto-clear)."
                            break
                    continue
                # not JSON we understand — fall through to text heuristics
            # standalone pairing code on stdout (XXXX-XXXX)
            if _PAIR_CODE_RE.match(t):
                _pair_code = t.upper()
                continue
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
        if _pair_status == "paired":
            # Pull contact/group names into the NLP cache so voice
            # ("send WhatsApp to kunal…") resolves without manual entry.
            threading.Thread(target=sync_contacts_cache, daemon=True).start()
    except Exception as e:
        _pair_status = "error"
        _pair_error = str(e)[:500]


def pair_qr() -> dict:
    global _pair_proc, _pair_status, _pair_qr, _pair_code
    if not is_installed():
        return {
            "status": "error",
            "qr_text": "",
            "error": "wacli is not installed. Install it first (button below or: brew install openclaw/tap/wacli).",
            "installed": False,
            "running": False,
        }
    with _lock:
        proc_running = _pair_proc is not None and _pair_proc.poll() is None
    st = get_status()
    if st.get("paired"):
        # Pairing completed (possibly detected via status, not the watcher):
        # stop our auth proc if it lingers, sync contact names once.
        with _lock:
            was_waiting = _pair_status == "waiting"
            if _pair_proc and _pair_proc.poll() is None:
                try:
                    _pair_proc.terminate()
                except Exception:
                    pass
            _pair_proc = None
            _pair_status = "paired"
            _pair_qr = ""
            _pair_code = ""
        if was_waiting:
            threading.Thread(target=sync_contacts_cache, daemon=True).start()
        result = {"status": "paired", "qr_text": "", "pair_code": "", "paired": True}
        result.update({k: v for k, v in (("jid", st.get("jid")), ("phone", st.get("phone"))) if v})
        return result
    return {
        "status": _pair_status,
        "mode": _pair_mode,
        "qr_text": _pair_qr,
        "pair_code": _pair_code,
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
            time.sleep(1.5)  # let the store LOCK release so next Pair starts clean
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

# --- Read messages (wacli local DB backed) ---

def _to_jid(recipient: str) -> str:
    """Normalize a phone or cached JID into a chat JID for --chat filters."""
    r = (recipient or "").strip()
    if "@" in r:
        return r
    digits = re.sub(r"\D", "", r)
    return f"{digits}@s.whatsapp.net" if digits else r

def _fmt_ts(ts: str) -> str:
    """wacli timestamps are UTC ISO ('...Z'). Render in the server's local
    timezone (the user's machine) so 'when' answers match their clock."""
    s = (ts or "").strip()
    if not s:
        return ""
    try:
        iso = s.replace("Z", "+00:00") if s.endswith(("Z", "z")) else s
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime("%b %d, %I:%M %p").replace(" 0", " ")
    except Exception:
        return s

def _norm_message(it: dict) -> dict:
    """Best-effort normalize one wacli message row across output shapes.

    Real wacli shape: ChatJID/ChatName/SenderJID/SenderName/Timestamp/
    FromMe/Text/MediaType. Aliases cover older/flat variants.
    """
    if not isinstance(it, dict):
        return {"text": str(it)[:500]}
    text = it.get("Text", it.get("text", it.get("body", it.get("message", it.get("content", "")))))
    if isinstance(text, dict):
        text = text.get("text", text.get("body", str(text)))
    chat = it.get("ChatJID", it.get("chat", it.get("chat_jid", it.get("remote_jid", it.get("jid", "")))))
    if isinstance(chat, dict):
        chat = chat.get("jid", chat.get("name", str(chat)))
    chat_name = it.get("ChatName", "")
    sender = it.get("SenderName", it.get("sender", it.get("sender_jid", it.get("push_name", it.get("author", "")))))
    if isinstance(sender, dict):
        sender = sender.get("push_name", sender.get("jid", str(sender)))
    if not sender and it.get("SenderJID"):
        sender = it.get("SenderJID")
    ts = it.get("Timestamp", it.get("timestamp", it.get("ts", it.get("sent_at", it.get("time", "")))))
    from_me = it.get("FromMe", it.get("from_me", it.get("fromMe", it.get("is_from_me", False))))
    mtype = it.get("MediaType", it.get("type", it.get("message_type", "text"))) or "text"
    if mtype is True or mtype == "":
        mtype = "text"
    return {
        "chat": str(chat or ""),
        "chat_name": str(chat_name or ""),
        "sender": str(sender or ""),
        "from_me": bool(from_me),
        "timestamp": _fmt_ts(str(ts or "")),
        "type": str(mtype),
        "text": str(text or "")[:2000],
    }

def _parse_rows(out: str) -> list[dict]:
    try:
        payload = json.loads(out)
    except Exception:
        return []
    items = payload if isinstance(payload, list) else payload.get("data", payload.get("messages", []))
    if isinstance(items, dict):  # {"fts":..,"messages":[...]} envelope
        items = items.get("messages", items.get("data", []))
    if not isinstance(items, list):
        return []
    return [_norm_message(it) for it in items if isinstance(it, dict)]

def _require_paired() -> dict | None:
    st = get_status()
    if not st.get("paired"):
        if not is_installed():
            return {"error": "wacli not installed. Install it in Settings → WhatsApp first.", "code": "not_installed"}
        return {"error": "WhatsApp is not linked. Open Settings → WhatsApp → Pair / Show QR and scan with your phone first.", "code": "needs_login"}
    return None

_last_sync_at: float = 0.0
SYNC_TTL_SECONDS = 60.0

def sync_once(timeout: int = 90) -> dict:
    """Pull latest messages into the local DB (blocking, one shot).

    --idle-exit caps the idle tail so a quiet account returns fast instead
    of sitting out the full default window.
    """
    if not is_installed():
        return {"ok": False, "error": "wacli not installed"}
    res = _run(_base_args() + ["sync", "--once", "--idle-exit", "10s"], timeout=timeout)
    if res.get("returncode") == 0:
        global _last_sync_at
        _last_sync_at = time.time()
        return {"ok": True}
    return {"ok": False, "error": (res.get("stderr") or res.get("stdout") or "sync failed")[:500]}

def _sync_stamp() -> str:
    if not _last_sync_at:
        return "never"
    try:
        return datetime.fromtimestamp(_last_sync_at).isoformat(timespec="seconds")
    except Exception:
        return "unknown"


def _maybe_sync(timeout: int = 60):
    """Best-effort freshness: sync at most once per SYNC_TTL_SECONDS.

    Skipped entirely while the background follow-sync is alive (the DB is
    then continuously fresh and a blocking --once would just contend).
    """
    if _follow_state.get("alive"):
        return
    if time.time() - _last_sync_at < SYNC_TTL_SECONDS:
        return
    try:
        sync_once(timeout=timeout)
    except Exception as e:
        logger.debug("background sync failed: %s", e)


# --- Background follow-sync: one long-lived `wacli sync` keeps the local DB
# continuously fresh so reads never wait on a blocking --once. ---

_follow_state = {"alive": False, "started_at": 0.0, "restarts": 0, "last_error": ""}
_follow_lock = threading.RLock()  # reentrant: ensure_follow_sync nests follow_status()

def follow_status() -> dict:
    with _follow_lock:
        return dict(_follow_state)

def _follow_worker():
    backoff = 5.0
    while True:
        try:
            bin_path = _wacli_bin()
            if not bin_path:
                with _follow_lock:
                    _follow_state.update({"alive": False, "last_error": "wacli not installed"})
                return
            st = get_status()
            if not st.get("paired"):
                with _follow_lock:
                    _follow_state.update({"alive": False, "last_error": "not paired — start after linking"})
                return
            with _follow_lock:
                _follow_state.update({"alive": True, "started_at": time.time(), "last_error": ""})
                _follow_state["restarts"] += 1
            logger.info("[wacli-follow] starting continuous sync")
            proc = subprocess.Popen(
                [bin_path] + (["--account", WACLI_ACCOUNT] if WACLI_ACCOUNT else []) +
                ["sync", "--follow", "--presence-mode", "quiet"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            proc.wait()
            logger.warning("[wacli-follow] sync exited (rc=%s), restarting in %.0fs", proc.returncode, backoff)
        except Exception as e:
            logger.warning("[wacli-follow] error: %s", e)
            with _follow_lock:
                _follow_state["last_error"] = str(e)[:300]
        with _follow_lock:
            _follow_state["alive"] = False
        time.sleep(backoff)
        backoff = min(backoff * 2, 120.0)

_follow_thread: threading.Thread | None = None

def ensure_follow_sync() -> dict:
    """Start the background continuous sync once (idempotent). Call at
    backend startup and lazily before reads."""
    global _follow_thread
    with _follow_lock:
        if _follow_thread is not None and _follow_thread.is_alive():
            return {"status": "already_running", **follow_status()}
        _follow_thread = threading.Thread(target=_follow_worker, daemon=True, name="wacli-follow")
        _follow_thread.start()
        return {"status": "started", **follow_status()}

def _find_chat_jid(name: str) -> tuple[str | None, str]:
    """Authoritative chat lookup straight from `wacli chats list` (DMs +
    groups). Returns (jid, display_name). Exact case-insensitive match wins,
    then phone-digit match, then prefix match."""
    res = _run(_base_args() + ["chats", "list", "--json"], timeout=20)
    out = (res.get("stdout") or "").strip()
    if not out or res.get("returncode") != 0:
        return None, ""
    try:
        payload = json.loads(out)
    except Exception:
        return None, ""
    items = payload if isinstance(payload, list) else payload.get("data", payload.get("chats", []))
    if not isinstance(items, list):
        return None, ""
    want = (name or "").strip().lower()
    digits = re.sub(r"\D", "", want)
    prefix: tuple[str | None, str] = (None, "")
    for it in items:
        if not isinstance(it, dict):
            continue
        jid = str(it.get("jid", it.get("phone", it.get("id", ""))))
        cname = str(it.get("name", it.get("push_name", it.get("title", ""))))
        if not jid:
            continue
        if cname.lower() == want and cname != jid:
            return jid, cname
        if digits and digits in re.sub(r"\D", "", jid):
            return jid, cname or jid
        if not prefix[0] and cname.lower().startswith(want) and cname != jid:
            prefix = (jid, cname)
    return prefix


def _resolve_chat(chat_raw: str) -> tuple[str | None, dict]:
    """Resolve a human chat reference (name/phone/group) to a JID + audit."""
    raw = (chat_raw or "").strip()
    if not raw:
        return None, {"status": "unknown", "reason": "empty chat"}
    if "@" in raw:  # already a JID
        return raw, {"status": "jid", "matched": raw}
    # 1) authoritative chat list first (exact DM/group names, fresh)
    jid, display = _find_chat_jid(raw)
    if jid:
        return jid, {"status": "exact", "matched": display or jid, "score": 100.0, "phone": jid}
    # 2) NLP contact resolver fallback (phones, saved contacts)
    resolved = whatsapp_contacts.resolve_contact(raw)
    status = resolved.get("status")
    if status in ("exact", "fuzzy", "phone"):
        return _to_jid(str(resolved.get("phone", raw))), resolved
    if status == "ambiguous":
        return None, {"status": "ambiguous", "candidates": resolved.get("candidates", [])}
    return None, {"status": "unknown_recipient", "to_raw": raw,
                  "reason": resolved.get("reason", "no match — add contact in Settings or sync wacli")}

def read_messages(chat: str, limit: int = 10, from_them: bool = True,
                  sync: bool = True) -> dict:
    """Read recent messages with someone (DM) or a group. Returns newest-first
    normalized rows plus who it's with."""
    gate = _require_paired()
    if gate:
        return gate
    try:
        ensure_follow_sync()
    except Exception:
        pass
    jid, audit = _resolve_chat(chat)
    if not jid:
        return {"error": audit.get("reason", "unknown recipient"), "code": audit.get("status", "unknown"), **audit}
    if sync:
        _maybe_sync()
    args = _base_args() + ["messages", "list", "--chat", jid, "--limit", str(max(1, min(limit, 50))), "--json"]
    if from_them:
        args.append("--from-them")
    res = _run(args, timeout=30)
    if res.get("returncode") != 0:
        return {"error": (res.get("stderr") or res.get("stdout") or "read failed")[:500], "code": "read_failed"}
    rows = _parse_rows(res.get("stdout") or "")
    out: dict = {"status": "ok", "chat": jid, "count": len(rows), "messages": rows, "synced_at": _sync_stamp()}
    if audit.get("matched"):
        out["matched"] = audit.get("matched")
    if audit.get("score") is not None:
        out["nlp_score"] = audit.get("score")
    return out

def search_messages(query: str, chat: str | None = None, limit: int = 10) -> dict:
    """Full-text search across WhatsApp history, optionally within one chat."""
    gate = _require_paired()
    if gate:
        return gate
    q = (query or "").strip()
    if not q:
        return {"error": "Empty search query.", "code": "empty"}
    try:
        ensure_follow_sync()
    except Exception:
        pass
    args = _base_args() + ["messages", "search", q, "--limit", str(max(1, min(limit, 50))), "--json"]
    jid = None
    if chat:
        jid, audit = _resolve_chat(chat)
        if not jid:
            return {"error": audit.get("reason", "unknown recipient"), "code": audit.get("status", "unknown"), **audit}
        args += ["--chat", jid]
    else:
        _maybe_sync()
    res = _run(args, timeout=30)
    if res.get("returncode") != 0:
        return {"error": (res.get("stderr") or res.get("stdout") or "search failed")[:500], "code": "search_failed"}
    rows = _parse_rows(res.get("stdout") or "")
    return {"status": "ok", "query": q, "chat": jid, "count": len(rows), "messages": rows, "synced_at": _sync_stamp()}

def recent_chats(limit: int = 10, sync: bool = True) -> dict:
    """Latest active chats (DMs + groups) with last-message preview — the
    basis for 'any new messages?' / unread sweeps."""
    gate = _require_paired()
    if gate:
        return gate
    try:
        ensure_follow_sync()
    except Exception:
        pass
    if sync:
        _maybe_sync()
    res = _run(_base_args() + ["chats", "list", "--json"], timeout=20)
    out = (res.get("stdout") or "").strip()
    if not out or res.get("returncode") != 0:
        return {"error": "Could not list chats.", "code": "chats_failed"}
    try:
        payload = json.loads(out)
    except Exception:
        return {"error": "Could not parse chat list.", "code": "parse_failed"}
    items = payload if isinstance(payload, list) else payload.get("data", payload.get("chats", []))
    if not isinstance(items, list):
        return {"error": "Could not parse chat list.", "code": "parse_failed"}
    chats = []
    for it in items[: max(1, min(limit, 50))]:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name", it.get("push_name", it.get("title", ""))))
        jid = str(it.get("jid", it.get("phone", it.get("id", ""))))
        if name == jid:
            name = ""  # unresolved name — display falls back to number below
        chats.append({
            "name": name or jid.split("@")[0],
            "jid": jid,
            "kind": str(it.get("kind", "group" if jid.endswith("@g.us") else "dm")),
            "unread": bool(it.get("unread", False)),
            "unread_count": it.get("unread_count", 0),
            "last_active": _fmt_ts(str(it.get("last_message_ts", it.get("last_active", it.get("lastActive", it.get("updated_at", "")))))),
        })
    return {"status": "ok", "count": len(chats), "chats": chats, "synced_at": _sync_stamp()}

async def read_messages_async(chat: str, limit: int = 10, from_them: bool = True) -> dict:
    return await asyncio.to_thread(read_messages, chat, limit, from_them)

async def search_messages_async(query: str, chat: str | None = None, limit: int = 10) -> dict:
    return await asyncio.to_thread(search_messages, query, chat, limit)

async def recent_chats_async(limit: int = 10) -> dict:
    return await asyncio.to_thread(recent_chats, limit)


# --- One-click wacli installer (GitHub releases → ~/.woxus/bin) ---

_install_state = {"status": "idle", "log": [], "version": None}
_install_lock = threading.Lock()
_GH_LATEST = "https://api.github.com/repos/openclaw/wacli/releases/latest"


def _install_log(msg: str):
    with _install_lock:
        _install_state["log"].append(msg)
        _install_state["log"] = _install_state["log"][-30:]
    logger.info("[wacli-install] %s", msg)


def install_status() -> dict:
    with _install_lock:
        return {
            "status": _install_state["status"],
            "log": list(_install_state["log"]),
            "version": _install_state["version"],
            "installed": is_installed(),
        }


def start_install() -> dict:
    with _install_lock:
        if _install_state["status"] == "running":
            return {"status": "running"}
        _install_state.update({"status": "running", "log": [], "version": None})
    threading.Thread(target=_install_worker, daemon=True).start()
    return {"status": "running"}


def _install_worker():
    try:
        sysname = _platform.system().lower()  # darwin | linux | windows
        march = _platform.machine().lower()  # arm64 | aarch64 | x86_64 | amd64
        os_token = {"darwin": "darwin", "linux": "linux", "windows": "windows"}.get(sysname, sysname)
        arch_token = "arm64" if march in ("arm64", "aarch64") else "amd64" if march in ("x86_64", "amd64") else march
        _install_log(f"Platform: {sysname}/{march} → looking for _{os_token}_{arch_token} archive")

        req = urllib.request.Request(_GH_LATEST, headers={"Accept": "application/json", "User-Agent": "Woxus"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            release = json.loads(resp.read().decode())
        assets = release.get("assets", [])
        tag = release.get("tag_name", "?")
        _install_log(f"Latest release: {tag} ({len(assets)} assets)")

        pick = None
        for a in assets:
            name = str(a.get("name", ""))
            if f"_{os_token}_{arch_token}." not in name or "universal" in name:
                continue
            if name.endswith(".tar.gz") or name.endswith(".zip"):
                pick = a
                break
        if pick is None:
            names = ", ".join(str(a.get("name", "")) for a in assets if "wacli_" in str(a.get("name", "")))
            raise RuntimeError(f"No matching archive for {os_token}/{arch_token}. Available: {names or 'none'}")

        url = pick["browser_download_url"]
        _install_log(f"Downloading {pick['name']}…")
        tmpdir = tempfile.mkdtemp(prefix="wacli-install-")
        archive = os.path.join(tmpdir, pick["name"])
        dl_req = urllib.request.Request(url, headers={"User-Agent": "Woxus"})
        with urllib.request.urlopen(dl_req, timeout=180) as resp, open(archive, "wb") as f:
            shutil.copyfileobj(resp, f)

        _install_log("Extracting…")
        if archive.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(tmpdir)
        else:
            with tarfile.open(archive) as t:
                t.extractall(tmpdir)

        binary = None
        want = "wacli.exe" if sysname == "windows" else "wacli"
        for root, _dirs, files in os.walk(tmpdir):
            if want in files:
                binary = os.path.join(root, want)
                break
        if binary is None:
            raise RuntimeError("Archive extracted but no wacli binary found inside")

        BIN_DIR.mkdir(parents=True, exist_ok=True)
        dest = BIN_DIR / want
        shutil.move(binary, dest)
        if sysname != "windows":
            os.chmod(dest, os.stat(dest).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            # Strip any quarantine flag so Gatekeeper never blocks the child
            # process on first run (urllib doesn't set it, browsers do — belt
            # and braces for manually placed files).
            try:
                subprocess.run(["xattr", "-d", "com.apple.quarantine", str(dest)],
                               capture_output=True, timeout=10)
            except Exception:
                pass
        shutil.rmtree(tmpdir, ignore_errors=True)

        ver = _run([str(dest), "--version"], timeout=20)
        version = ((ver.get("stdout") or "") + (ver.get("stderr") or "")).strip().splitlines()
        version = version[0][:80] if version else "installed"
        with _install_lock:
            _install_state.update({"status": "done", "version": version})
        _install_log(f"Installed: {version}")
    except Exception as e:
        with _install_lock:
            _install_state.update({"status": "error"})
        _install_log(f"Install failed: {e}")
