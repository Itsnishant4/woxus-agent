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
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from datetime import datetime
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
