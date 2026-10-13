"""Woxus — cross-platform app launcher with fuzzy macOS resolution.

Why this exists: the mini agent used to guess raw shell (`open -a <name>`)
which fails on macOS for inexact names ("chrome" vs "Google Chrome",
"vscode" vs "Visual Studio Code"), articles ("open the calculator"), and
gives no launched/not-launched verification. This module resolves the real
.app bundle first, launches it, then verifies.

Stdlib only — safe to import anywhere (no google/httpx deps).
"""

import asyncio
import logging
import os
import platform
import re
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# macOS bundle search roots (order = preference).
_MAC_SEARCH_DIRS = (
    "/Applications",
    str(Path.home() / "Applications"),
    "/System/Applications",
    "/System/Library/CoreServices",
    "/Applications/Utilities",
)

# Common spoken names -> exact .app bundle names (macOS).
_COMMON_ALIASES = {
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "chrom": "Google Chrome",
    "safari": "Safari",
    "firefox": "Firefox",
    "edge": "Microsoft Edge",
    "microsoft edge": "Microsoft Edge",
    "brave": "Brave Browser",
    "arc": "Arc",
    "vscode": "Visual Studio Code",
    "vs code": "Visual Studio Code",
    "visual studio code": "Visual Studio Code",
    "code": "Visual Studio Code",
    "cursor": "Cursor",
    "sublime": "Sublime Text",
    "sublime text": "Sublime Text",
    "iterm": "iTerm",
    "iterm2": "iTerm",
    "terminal": "Terminal",
    "finder": "Finder",
    "notes": "Notes",
    "calculator": "Calculator",
    "calendar": "Calendar",
    "mail": "Mail",
    "messages": "Messages",
    "facetime": "FaceTime",
    "photos": "Photos",
    "music": "Music",
    "spotify": "Spotify",
    "slack": "Slack",
    "discord": "Discord",
    "zoom": "zoom.us",
    "zoom.us": "zoom.us",
    "notion": "Notion",
    "figma": "Figma",
    "whatsapp": "WhatsApp",
    "telegram": "Telegram",
    "settings": "System Settings",
    "system settings": "System Settings",
    "system preferences": "System Settings",
    "preferences": "System Settings",
    "app store": "App Store",
    "activity monitor": "Activity Monitor",
    "preview": "Preview",
    "textedit": "TextEdit",
    "xcode": "Xcode",
    "siri": "Siri",
    "maps": "Maps",
    "news": "News",
    "reminders": "Reminders",
    "contacts": "Contacts",
    "keychain": "Keychain Access",
    "disk utility": "Disk Utility",
}

_NOISE_RE = re.compile(r"\b(app|application)\b", re.IGNORECASE)


def clean_app_name(raw: str) -> str:
    """Strip articles, quotes, trailing 'app', fillers from a spoken name."""
    s = (raw or "").strip().strip("\"'“”‘’`")
    s = re.sub(r"^(?:please\s+)?(?:open|launch|start|show|run)\s+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^(?:a\s+|an\s+|the\s+|my\s+)", "", s, flags=re.IGNORECASE)
    s = _NOISE_RE.sub("", s)
    s = re.sub(r"\s+(for\s+me|please|now|again)\s*$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip().strip("\"'“”‘’`")
    if s.lower().endswith(".app"):
        s = s[:-4].strip()
    return s


def _candidate_names(raw: str) -> list[str]:
    """Ordered display-name candidates for a spoken request."""
    name = clean_app_name(raw)
    cands: list[str] = []
    for c in (name, _COMMON_ALIASES.get(name.lower(), "")):
        if c and c not in cands:
            cands.append(c)
    return cands


def _iter_installed_apps() -> dict[str, str]:
    """Map lowercase bundle display name -> full .app path (macOS)."""
    found: dict[str, str] = {}
    for d in _MAC_SEARCH_DIRS:
        try:
            entries = os.listdir(d)
        except OSError:
            continue
        for e in entries:
            if e.startswith(".") or not e.endswith(".app"):
                continue
            found.setdefault(e[:-4].lower(), os.path.join(d, e))
    return found


def resolve_mac_app(raw_name: str) -> dict:
    """Fuzzy-resolve a spoken name to an installed .app bundle.

    Returns {found, path, display_name, tried}. Never raises.
    """
    tried = _candidate_names(raw_name)
    if not tried or not tried[0]:
        return {"found": False, "path": "", "display_name": "", "tried": tried}
    installed = _iter_installed_apps()

    # 1) exact (case-insensitive).
    for cand in tried:
        hit = installed.get(cand.lower())
        if hit:
            return {"found": True, "path": hit, "display_name": cand, "tried": tried}

    # 2) alias target already covered; 3) prefix / substring match.
    want = tried[0].lower()
    for disp_lower, path in installed.items():
        if disp_lower.startswith(want) or want.startswith(disp_lower):
            return {"found": True, "path": path, "display_name": os.path.basename(path)[:-4], "tried": tried}
    for disp_lower, path in installed.items():
        if want in disp_lower or disp_lower in want:
            return {"found": True, "path": path, "display_name": os.path.basename(path)[:-4], "tried": tried}

    # 4) token match ("studio code" -> "Visual Studio Code").
    want_tokens = set(want.split())
    best: tuple[int, str, str] | None = None
    for disp_lower, path in installed.items():
        overlap = len(want_tokens & set(disp_lower.split()))
        if overlap and (best is None or overlap > best[0]):
            best = (overlap, path, os.path.basename(path)[:-4])
    if best:
        return {"found": True, "path": best[1], "display_name": best[2], "tried": tried}

    return {"found": False, "path": "", "display_name": tried[0], "tried": tried}


async def _run(cmd: list[str], timeout: int = 15) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode or 0, out.decode(errors="replace").strip(), err.decode(errors="replace").strip()
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return -1, "", f"timed out after {timeout}s"


async def _is_running_mac(display_name: str) -> bool:
    """Best-effort check the app process is alive (pgrep, no shell)."""
    base = os.path.splitext(os.path.basename(display_name))[0]
    if not base:
        return False
    for probe in (base, base.replace(" ", "")):
        code, out, _ = await _run(["pgrep", "-x", probe], timeout=5)
        if code == 0 and out:
            return True
    code, out, _ = await _run(["pgrep", "-f", base], timeout=5)
    return code == 0 and bool(out)


async def open_app(app_name: str, args: list[str] | None = None) -> dict:
    """Launch an app by spoken name. Returns structured status dict."""
    raw = (app_name or "").strip()
    if not raw:
        return {"status": "failed", "error": "No app name given. Say e.g. 'open Calculator'."}
    system = platform.system().lower()

    # A real file path wins over app resolution ("open ~/Desktop/notes.txt").
    expanded = os.path.abspath(os.path.expanduser(raw.strip("\"'")))
    if os.path.exists(expanded):
        if system == "darwin":
            code, _, err = await _run(["open", expanded])
            if code == 0:
                return {"status": "success", "app": raw, "path": expanded, "message": f"Opened {raw}."}
            return {"status": "failed", "error": err or f"Could not open {raw}."}
        if system == "windows":
            os.startfile(expanded)  # noqa: E1101 pylint: disable=no-member
            return {"status": "success", "app": raw, "path": expanded, "message": f"Opened {raw}."}
        opener = shutil.which("xdg-open") or shutil.which("gio")
        if opener:
            code, _, err = await _run([opener, expanded] if "xdg" in opener else [opener, "open", expanded])
            if code == 0:
                return {"status": "success", "app": raw, "path": expanded, "message": f"Opened {raw}."}
            return {"status": "failed", "error": err or f"Could not open {raw}."}
        return {"status": "failed", "error": f"Could not open {raw} on {system}."}

    if system == "darwin":
        resolved = resolve_mac_app(raw)
        if not resolved["found"]:
            hint = ", ".join(resolved["tried"][:2]) or raw
            return {
                "status": "failed",
                "error": f"App '{hint}' is not installed (checked /Applications).",
            }
        path = resolved["path"]
        display = resolved["display_name"]
        cmd = ["open", "-a", path]
        if args:
            cmd += ["--args"] + list(args)
        code, _, err = await _run(cmd)
        if code != 0:
            # Fallback: open the bundle path directly.
            code2, _, err2 = await _run(["open", path])
            if code2 != 0:
                return {"status": "failed", "app": display, "path": path, "error": err or err2 or f"Could not open {display}."}
        running = await _is_running_mac(display)
        msg = f"Opened {display}." if running else f"Launch signal sent to {display}."
        logger.info("[open_app] launched %s (%s) running=%s", display, path, running)
        return {"status": "success", "app": display, "path": path, "running": running, "message": msg}

    if system == "windows":
        # Best effort: start via shell lookup, then PATH fallback.
        import subprocess

        try:
            subprocess.Popen(["cmd", "/c", "start", "", raw], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return {"status": "success", "app": raw, "message": f"Opened {raw}."}
        except Exception as e:
            return {"status": "failed", "error": f"Could not open {raw}: {e}"}
    opener = shutil.which("xdg-open") or shutil.which("gio")
    if opener:
        code, _, err = await _run([opener, raw] if "xdg" in opener else [opener, "open", raw])
        if code == 0:
            return {"status": "success", "app": raw, "message": f"Opened {raw}."}
        return {"status": "failed", "error": err or f"Could not open {raw}."}
    return {"status": "failed", "error": f"Opening apps is not supported on {system}."}
