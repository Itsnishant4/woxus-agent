"""Woxus — cross-platform app launcher with fuzzy resolution.

Why this exists: the mini agent used to guess raw shell (`open -a <name>` on
macOS, bare `start <name>` on Windows) which fails for inexact names
("chrome" vs "Google Chrome", "vscode" vs "Visual Studio Code"), articles
("open the calculator"), Store/UWP apps (Windows Calculator/Settings have no
plain exe), and never verified the launch. This module resolves the real
target first, launches it, then verifies.

Stdlib only — safe to import anywhere (no google/httpx deps). Windows-only
APIs (winreg) are imported lazily inside functions so macOS/Linux imports
never break.
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


def _fuzzy_display_pick(want: str, names: list[str]) -> str:
    """Pick best display-name match: exact → prefix → substring → token overlap.

    Returns the matched name or "". Pure function shared by macOS + Windows.
    """
    w = (want or "").strip().lower()
    if not w:
        return ""
    lowered = {n.lower(): n for n in names}
    if w in lowered:
        return lowered[w]
    for key, orig in lowered.items():
        if key.startswith(w) or w.startswith(key):
            return orig
    for key, orig in lowered.items():
        if w in key or key in w:
            return orig
    want_tokens = set(w.split())
    best: tuple[int, str] | None = None
    for key, orig in lowered.items():
        overlap = len(want_tokens & set(key.split()))
        if overlap and (best is None or overlap > best[0]):
            best = (overlap, orig)
    return best[1] if best else ""


# --- Windows tables ---

# Spoken name -> executable basename (App Paths / PATH lookup).
_WIN_EXE_ALIASES = {
    "chrome": "chrome.exe",
    "google chrome": "chrome.exe",
    "chrom": "chrome.exe",
    "edge": "msedge.exe",
    "microsoft edge": "msedge.exe",
    "firefox": "firefox.exe",
    "brave": "brave.exe",
    "opera": "opera.exe",
    "vscode": "Code.exe",
    "vs code": "Code.exe",
    "visual studio code": "Code.exe",
    "code": "Code.exe",
    "visual studio": "devenv.exe",
    "cursor": "Cursor.exe",
    "sublime": "sublime_text.exe",
    "sublime text": "sublime_text.exe",
    "notepad": "notepad.exe",
    "notepad++": "notepad++.exe",
    "calculator": "calc.exe",
    "calc": "calc.exe",
    "paint": "mspaint.exe",
    "mspaint": "mspaint.exe",
    "snipping tool": "SnippingTool.exe",
    "file explorer": "explorer.exe",
    "explorer": "explorer.exe",
    "task manager": "Taskmgr.exe",
    "control panel": "control.exe",
    "command prompt": "cmd.exe",
    "cmd": "cmd.exe",
    "powershell": "powershell.exe",
    "terminal": "wt.exe",
    "windows terminal": "wt.exe",
    "word": "WINWORD.EXE",
    "excel": "EXCEL.EXE",
    "powerpoint": "POWERPNT.EXE",
    "outlook": "OUTLOOK.EXE",
    "onenote": "ONENOTE.EXE",
    "teams": "ms-teams.exe",
    "spotify": "Spotify.exe",
    "slack": "slack.exe",
    "discord": "Discord.exe",
    "zoom": "Zoom.exe",
    "notion": "Notion.exe",
    "figma": "Figma.exe",
    "whatsapp": "WhatsApp.exe",
    "telegram": "Telegram.exe",
    "vlc": "vlc.exe",
    "7zip": "7zFM.exe",
    "winrar": "WinRAR.exe",
    "git bash": "bash.exe",
}

# Spoken name -> Settings/Store URI (no exe exists for these).
_WIN_PROTOCOLS = {
    "settings": "ms-settings:",
    "system settings": "ms-settings:",
    "windows settings": "ms-settings:",
    "windows update": "ms-settings:windowsupdate",
    "bluetooth": "ms-settings:bluetooth",
    "wifi": "ms-settings:network-wifi",
    "microsoft store": "ms-windows-store:",
    "store": "ms-windows-store:",
}

# Spoken name -> Store app (shell:AppsFolder ID) fallback when Get-StartApps
# enumeration is unavailable (PowerShell constrained / timeout).
_WIN_UWP_FALLBACK = {
    "calculator": "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
    "windows calculator": "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
    "photos": "Microsoft.Windows.Photos_8wekyb3d8bbwe!App",
    "camera": "Microsoft.WindowsCamera_8wekyb3d8bbwe!App",
    "alarms": "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App",
    "clock": "Microsoft.WindowsAlarms_8wekyb3d8bbwe!App",
    "notepad": "Microsoft.WindowsNotepad_8wekyb3d8bbwe!Application",
    "terminal": "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App",
    "windows terminal": "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App",
    "store": "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
    "microsoft store": "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
    "xbox": "Microsoft.XboxApp_8wekyb3d8bbwe!App",
    "solitaire": "Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe!App",
}

_WIN_APP_PATHS_KEY = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"


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

    # 2-4) prefix / substring / token match over installed bundle names.
    want = tried[0]
    pick = _fuzzy_display_pick(want, [os.path.basename(p)[:-4] for p in installed.values()])
    if pick:
        return {"found": True, "path": installed[pick.lower()], "display_name": pick, "tried": tried}

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
    except Exception as e:
        # Missing binary (where/tasklist/powershell absent on non-Windows),
        # permission errors, etc. — report, never raise (keeps the async
        # resolution chain alive on every platform).
        return -1, "", str(e) or e.__class__.__name__


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


# --- Windows resolution ---

def _win_display_candidates(raw: str) -> list[str]:
    """Ordered display-name candidates for Start Menu / Store matching.

    Reuses the Common display aliases (vscode → Visual Studio Code,
    chrome → Google Chrome) plus the raw cleaned name.
    """
    name = clean_app_name(raw)
    cands: list[str] = []
    for c in (name, _COMMON_ALIASES.get(name.lower(), "")):
        if c and c not in cands:
            cands.append(c)
    return cands


def _win_exe_for(raw: str) -> str:
    """Map a spoken name to an exe basename (alias table + .exe suffix)."""
    name = clean_app_name(raw)
    if not name:
        return ""
    low = name.lower()
    if low in _WIN_EXE_ALIASES:
        return _WIN_EXE_ALIASES[low]
    compact = re.sub(r"\s+", "", name)
    if compact.lower().endswith(".exe"):
        return compact
    if re.fullmatch(r"[A-Za-z0-9_+\-.]+", name) and " " not in name:
        return name if name.lower().endswith(".exe") else f"{name}.exe"
    return ""


def _win_app_paths_lookup(exe: str) -> str:
    """Resolve via App Paths registry (HKLM + HKCU). Returns exe path or ""."""
    if not exe:
        return ""
    try:
        import winreg
    except ImportError:
        return ""
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(root, f"{_WIN_APP_PATHS_KEY}\\{exe}") as key:
                path, _ = winreg.QueryValueEx(key, "")
                if path and os.path.exists(path):
                    return path
                if path:
                    return path
        except OSError:
            continue
    return ""


async def _win_where(exe: str) -> str:
    """Resolve via PATH (`where.exe`). Returns full path or ""."""
    if not exe:
        return ""
    code, out, _ = await _run(["where", exe], timeout=10)
    if code != 0 or not out:
        return ""
    for line in out.splitlines():
        cand = line.strip().strip("\"'")
        if cand and os.path.exists(cand):
            return cand
    return ""


def _win_start_menu_roots() -> list[str]:
    """Start Menu program dirs. WOXUS_START_MENU_DIRS overrides for tests."""
    override = os.getenv("WOXUS_START_MENU_DIRS", "").strip()
    if override:
        return [p for p in override.split(os.pathsep) if p]
    roots = []
    for var in ("ProgramData", "APPDATA"):
        base = os.getenv(var, "")
        if base:
            roots.append(os.path.join(base, r"Microsoft\Windows\Start Menu\Programs"))
    return [r for r in roots if r]


def _win_start_menu_lnk(raw: str, cap_files: int = 3000) -> str:
    """Fuzzy-match a Start Menu shortcut. Returns .lnk path or ""."""
    cands = _win_display_candidates(raw)
    if not cands or not cands[0]:
        return ""
    found: dict[str, str] = {}  # display name -> lnk path
    scanned = 0
    for root in _win_start_menu_roots():
        for dirpath, _, files in os.walk(root):
            for f in files:
                if not f.lower().endswith(".lnk") or f.startswith("."):
                    continue
                found.setdefault(f[:-4], os.path.join(dirpath, f))
                scanned += 1
                if scanned >= cap_files:
                    break
            if scanned >= cap_files:
                break
    if not found:
        return ""
    names = list(found.keys())
    for want in cands:
        pick = _fuzzy_display_pick(want, names)
        if pick:
            return found[pick]
    return ""


async def _win_uwp_appid(raw: str) -> str:
    """Resolve a Store app via Get-StartApps enumeration, static fallback.

    Returns shell:AppsFolder ID or "".
    """
    cands = _win_display_candidates(raw)
    if not cands or not cands[0]:
        return ""
    try:
        code, out, _ = await _run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"],
            timeout=15,
        )
        if code == 0 and out:
            import json

            data = json.loads(out)
            rows = data if isinstance(data, list) else [data]
            names = [str(r.get("Name", "")) for r in rows if r.get("Name")]
            for want in cands:
                pick = _fuzzy_display_pick(want, names)
                if pick:
                    for r in rows:
                        if str(r.get("Name", "")) == pick and r.get("AppID"):
                            return str(r["AppID"])
    except Exception as e:
        logger.warning("[open_app] Get-StartApps failed: %s", e)
    for want in cands:
        alias = _WIN_UWP_FALLBACK.get(want.lower(), "")
        if alias:
            return alias
        pick = _fuzzy_display_pick(want, list(_WIN_UWP_FALLBACK.keys()))
        if pick and _WIN_UWP_FALLBACK.get(pick):
            return _WIN_UWP_FALLBACK[pick]
    return ""


async def _win_is_running(exe_or_name: str) -> bool:
    """Best-effort process check via tasklist (no shell)."""
    base = os.path.basename(exe_or_name or "").strip()
    if not base:
        return False
    image = base if base.lower().endswith(".exe") else f"{base}.exe"
    code, out, _ = await _run(["tasklist", "/FI", f"IMAGENAME eq {image}", "/FO", "CSV", "/NH"], timeout=10)
    if code != 0 or not out:
        return False
    first = out.splitlines()[0].strip().strip("\"")
    return first.lower() == image.lower()


def resolve_win_app(raw_name: str) -> dict:
    """Sync half of Windows resolution (no subprocess): protocol + App Paths.

    Returns {found, kind, target, display, exe}. Callers continue with
    PATH / Start Menu / UWP lookups (async) when this reports not found.
    Never raises, never launches.
    """
    name = clean_app_name(raw_name)
    if not name:
        return {"found": False, "kind": "", "target": "", "display": "", "exe": ""}
    low = name.lower()
    if low in _WIN_PROTOCOLS:
        return {"found": True, "kind": "protocol", "target": _WIN_PROTOCOLS[low],
                "display": name, "exe": ""}
    exe = _win_exe_for(raw_name)
    if exe:
        hit = _win_app_paths_lookup(exe)
        if hit:
            return {"found": True, "kind": "exe", "target": hit, "display": name, "exe": exe}
    return {"found": False, "kind": "", "target": "", "display": name, "exe": exe}


async def _launch_win_target(kind: str, target: str, exe: str, display: str, args: list[str] | None) -> dict:
    """Launch an already-resolved Windows target. Never raises."""
    import subprocess

    try:
        if kind == "protocol" or (isinstance(target, str) and re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target)):
            os.startfile(target)  # noqa: E1101 pylint: disable=no-member
        elif kind == "lnk" or (target.lower().endswith(".lnk") or target.lower().endswith(".url")):
            os.startfile(target)  # noqa: E1101 pylint: disable=no-member
        elif kind == "uwp":
            # Store app: explorer.exe shell:AppsFolder\<AppID>
            subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{target}"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif kind == "exe":
            cmd = [target] + list(args or [])
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             cwd=os.path.dirname(target) or None)
        else:
            subprocess.Popen(["cmd", "/c", "start", "", target],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        return {"status": "failed", "app": display, "error": f"Could not open {display}: {e}"}

    verify = exe or (os.path.basename(target) if target.lower().endswith(".exe") else "")
    running = await _win_is_running(verify) if verify else False
    # UWP processes hide behind ApplicationFrameHost — give them a moment, then
    # accept the launch signal if the broker is alive.
    if not running and kind == "uwp":
        await asyncio.sleep(2)
        running = await _win_is_running("ApplicationFrameHost.exe") or await _win_is_running(display)
    msg = f"Opened {display}." if running else f"Launch signal sent to {display}."
    logger.info("[open_app] launched %s (%s) running=%s", display, target, running)
    return {"status": "success", "app": display, "path": target, "running": running, "message": msg}


async def _open_windows(raw: str, args: list[str] | None) -> dict:
    """Full Windows flow: resolve (App Paths → PATH → Start Menu → UWP →
    raw start fallback), launch, verify. Never raises."""
    # 1) Registry fast path + protocol URIs.
    resolved = resolve_win_app(raw)
    if resolved["found"] and resolved["kind"] in ("protocol", "exe"):
        return await _launch_win_target(resolved["kind"], resolved["target"],
                                        resolved["exe"], resolved["display"], args)

    exe = resolved["exe"] or _win_exe_for(raw)
    display = resolved["display"] or clean_app_name(raw) or raw

    # 2) PATH (`where.exe`).
    if exe:
        hit = await _win_where(exe)
        if hit:
            return await _launch_win_target("exe", hit, exe, display, args)

    # 3) Start Menu shortcut.
    lnk = await asyncio.to_thread(_win_start_menu_lnk, raw)
    if lnk:
        return await _launch_win_target("lnk", lnk, exe, display, args)

    # 4) Store app enumeration (+ static fallback).
    appid = await _win_uwp_appid(raw)
    if appid:
        return await _launch_win_target("uwp", appid, exe, display, args)

    # 5) Last resort: classic `start` lookup (PATH aliases, verbs, URLs).
    # Verify afterwards so a silent no-op is reported honestly.
    import subprocess

    try:
        subprocess.Popen(["cmd", "/c", "start", "", raw],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        return {"status": "failed", "app": display, "error": f"Could not open {display}: {e}"}
    await asyncio.sleep(2)
    if exe and await _win_is_running(exe):
        return {"status": "success", "app": display, "running": True, "message": f"Opened {display}."}
    return {"status": "failed", "app": display,
            "error": f"App '{display}' was not found (checked App Paths, PATH, Start Menu, Store apps)."}


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
        return await _open_windows(raw, args)

    opener = shutil.which("xdg-open") or shutil.which("gio")
    if opener:
        code, _, err = await _run([opener, raw] if "xdg" in opener else [opener, "open", raw])
        if code == 0:
            return {"status": "success", "app": raw, "message": f"Opened {raw}."}
        return {"status": "failed", "error": err or f"Could not open {raw}."}
    return {"status": "failed", "error": f"Opening apps is not supported on {system}."}
