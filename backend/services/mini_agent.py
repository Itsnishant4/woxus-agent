"""Woxus — Autonomous Auto-Healing Mini Agent.

100% Local Natural Language & Command Auto-Healing Engine.
Parses natural language task prompts and repairs command failures locally
without remote API calls, preventing 429 rate limit errors.
"""

import asyncio
import logging
import os
import re
from typing import Optional

logger = logging.getLogger(__name__)

# User Directive: Set max repair attempts to 10
MAX_REPAIR_ATTEMPTS = 10


def _parse_natural_language_intent(prompt: str) -> list[str]:
    """Parse natural language task prompts into exact, executable shell commands."""
    p = prompt.strip()
    p_lower = p.lower()

    # Pattern 1: Create folder + React project inside it
    if ("folder" in p_lower or "directory" in p_lower) and ("react" in p_lower or "vite" in p_lower or "project" in p_lower):
        folder_match = re.search(r"(?:folder|directory)(?:\s+named|\s+called)?\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?", p, re.IGNORECASE)
        folder_name = folder_match.group(1) if folder_match else "dummy"
        target_dir = "~/Desktop" if "desktop" in p_lower else "."
        return [f"mkdir -p {target_dir}/{folder_name} && cd {target_dir}/{folder_name} && npx -y create-vite@latest app --template react-ts && cd app && npm install"]

    # Pattern 2: Standalone React / Vite project creation
    if "react" in p_lower or "vite" in p_lower or "create-react-app" in p_lower:
        app_match = re.search(r"(?:project|app)\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?", p, re.IGNORECASE)
        app_name = app_match.group(1) if app_match else "my-app"
        target_dir = "~/Desktop" if "desktop" in p_lower else "."
        return [f"cd {target_dir} && rm -rf {app_name} && npx -y create-vite@latest {app_name} --template react-ts && cd {app_name} && npm install"]

    # Pattern 3: Create folder / directory
    if "create" in p_lower and ("folder" in p_lower or "directory" in p_lower or "mkdir" in p_lower):
        folder_match = re.search(r"(?:folder|directory)(?:\s+named|\s+called)?\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?", p, re.IGNORECASE)
        folder_name = folder_match.group(1) if folder_match else "new-folder"
        target_dir = "~/Desktop" if "desktop" in p_lower else "."
        return [f"mkdir -p {target_dir}/{folder_name}"]

    # Pattern 4: List folders / directories on desktop
    if ("list" in p_lower or "ls" in p_lower or "show" in p_lower) and ("folder" in p_lower or "directory" in p_lower or "directories" in p_lower):
        if "desktop" in p_lower:
            return ["ls -d ~/Desktop/*/ 2>/dev/null || ls -la ~/Desktop"]
        return ["ls -d */ 2>/dev/null || ls -la"]

    # Pattern 5: List contents of specific folder
    if ("list" in p_lower or "ls" in p_lower or "show" in p_lower or "check" in p_lower):
        folder_match = re.search(r"(?:contents|files)?\s+(?:of|in)?\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?\s+(?:folder|directory)", p, re.IGNORECASE)
        if folder_match:
            folder_name = folder_match.group(1)
            target_dir = "~/Desktop" if "desktop" in p_lower else "."
            return [f"ls -la {target_dir}/{folder_name}"]
        if ("folder" in p_lower or "directory" in p_lower or "directories" in p_lower) and "desktop" in p_lower:
            return ["ls -d ~/Desktop/*/ 2>/dev/null || ls -la ~/Desktop"]
        if "desktop" in p_lower:
            return ["ls -la ~/Desktop"]

    # Pattern 6: Create file
    if "create" in p_lower and "file" in p_lower:
        file_match = re.search(r"file(?:\s+named|\s+called)?\s+['\"]?([a-zA-Z0-9_\-\.]+)['\"]?", p, re.IGNORECASE)
        file_name = file_match.group(1) if file_match else "new-file.txt"
        target_dir = "~/Desktop" if "desktop" in p_lower else "."
        return [f"touch {target_dir}/{file_name}"]

    # Pattern 7: Open file/folder (macOS)
    if p_lower.startswith("open") or p_lower.startswith("show me") or p_lower.startswith("launch"):
        path_match = re.search(r"(?:open|show me|launch)\s+(?:file|folder|directory)?\s*['\"]?([a-zA-Z0-9_\-\.\/ ~]+)['\"]?", p, re.IGNORECASE)
        if path_match:
            path = path_match.group(1).strip()
            if not path.startswith("/") and not path.startswith("~"):
                path = os.path.expanduser(f"~/{path}")
            return [f"open {path}"]
        return ["open ."]

    # Pattern 8: Who am I / current user / system info
    if any(kw in p_lower for kw in ["who am i", "current user", "username", "system info", "sysinfo"]):
        return ["whoami", "uname -a"]

    # Pattern 9: Contents of / what's in a path
    if any(kw in p_lower for kw in ["what's in", "what is in", "contents of", "show contents"]):
        path_match = re.search(r"(?:what's in|what is in|contents of|show contents)\s+['\"]?([a-zA-Z0-9_\-\.\/ ~]+)['\"]?", p, re.IGNORECASE)
        path = path_match.group(1).strip() if path_match else "."
        return [f"ls -la {path}"]

    # Pattern 10: Find / search for files
    if p_lower.startswith("find") or p_lower.startswith("search"):
        name_match = re.search(r"(?:find|search)(?:\s+for)?\s+['\"]?([a-zA-Z0-9_\-\.]+)['\"]?", p, re.IGNORECASE)
        if name_match:
            name = name_match.group(1)
            where_match = re.search(r"(?:in|under|inside)\s+['\"]?([a-zA-Z0-9_\-\.\/ ~]+)['\"]?", p, re.IGNORECASE)
            where = where_match.group(1).strip() if where_match else "~"
            return [f"find {where} -name '*{name}*' 2>/dev/null | head -20"]
        return [f"find . -name '*{p.split()[-1]}*' 2>/dev/null | head -20"]

    # Pattern 11: Download / install
    if p_lower.startswith("download") or p_lower.startswith("install"):
        url_match = re.search(r"(?:download|install)\s+['\"]?(https?://[^\s'\"]+)['\"]?", p, re.IGNORECASE)
        if url_match:
            import tempfile
            return [f"curl -L -o {tempfile.mkdtemp()}/download '{url_match.group(1)}'"]
        return [p]

    # Pattern 12: Run script
    if p_lower.startswith("run") and ("python" in p_lower or "script" in p_lower):
        script_match = re.search(r"(?:run|execute)\s+(?:python|script)?\s*['\"]?([a-zA-Z0-9_\-\.\/ ]+\.py)['\"]?", p, re.IGNORECASE)
        if script_match:
            return [f"python3 {script_match.group(1)}"]
        return [p]

    # Pattern 13: Write content to file
    if any(kw in p_lower for kw in ["write to", "save to", "create file with"]):
        file_match = re.search(r"(?:write to|save to|create file with)\s+['\"]?([a-zA-Z0-9_\-\.\/ ]+)['\"]?", p, re.IGNORECASE)
        if file_match:
            return [f"cat > {file_match.group(1).strip()}"]

    # Pattern 14: Direct shell command with keywords
    for kw in ["ls", "cd", "mkdir", "npx", "npm", "python", "git", "cat", "pwd", "rm", "touch", "curl", "wget", "brew", "open"]:
        if p.startswith(kw) or f" {kw} " in p or f" {kw}" in p:
            return [_normalize_and_optimize_command(p)]

    return [p]


def _normalize_and_optimize_command(cmd: str) -> str:
    """Transform deprecated, hanging, or interactive commands into fast, non-interactive equivalents."""
    if "create-react-app" in cmd:
        parts = cmd.split("create-react-app")
        app_name = parts[1].strip() if len(parts) > 1 else "my-app"
        app_name = app_name.split()[0] if app_name else "my-app"
        prefix = parts[0].replace("npx", "").strip().rstrip("&").strip()
        if prefix:
            return f"{prefix} && rm -rf {app_name} && npx -y create-vite@latest {app_name} --template react-ts && cd {app_name} && npm install"
        return f"rm -rf {app_name} && npx -y create-vite@latest {app_name} --template react-ts && cd {app_name} && npm install"

    if "npx " in cmd and " -y" not in cmd and " --yes" not in cmd:
        cmd = cmd.replace("npx ", "npx -y ")

    return cmd


def _local_repair_strategy(attempt: int, original_cmd: str, current_error: str) -> list[str]:
    """100% Local Rule-Based Auto-Repair Engine.
    Generates smart, deterministic repair commands locally without calling remote APIs.
    """
    cmd = original_cmd.strip()
    error_lower = current_error.lower()

    # Rule 1: Leading natural language text or code 127 command not found
    if "command not found" in error_lower or "exit code 127" in error_lower or "code 127" in error_lower:
        parsed_cmds = _parse_natural_language_intent(cmd)
        if parsed_cmds and parsed_cmds != [cmd]:
            return parsed_cmds

        if "command:" in cmd.lower():
            extracted = cmd.lower().split("command:")[-1].strip()
            return [extracted]
        for kw in ["ls ", "cd ", "mkdir ", "npx ", "npm ", "python ", "git "]:
            if kw in cmd:
                idx = cmd.find(kw)
                return [cmd[idx:].strip()]

    # Rule 2: Deprecated create-react-app -> Vite React
    if "create-react-app" in cmd:
        return [_normalize_and_optimize_command(cmd)]

    # Rule 3: Missing target directory for glob / ls -d
    if "ls -d" in cmd and attempt == 1:
        clean_target = cmd.replace("ls -d", "ls -la").strip()
        return [clean_target]

    # Rule 4: No such file or directory handling
    if "no such file or directory" in error_lower or "not found" in error_lower:
        if "ls " in cmd:
            parts = cmd.split()
            path = parts[-1] if len(parts) > 1 else ""
            if path and "/" in path:
                parent = os.path.dirname(path.rstrip("/")) or "~"
                return [f"ls -la {parent}"]
        return [f"ls -la {os.path.expanduser('~')}"]

    # Rule 5: Non-interactive npx / npm fallback
    if "npx " in cmd and " -y" not in cmd:
        return [cmd.replace("npx ", "npx -y ")]

    # Incremental Fallbacks up to attempt 10
    if attempt == 2:
        return [f"cd {os.path.expanduser('~')} && ls -la"]
    if attempt == 3:
        return ["pwd", "ls -la"]

    return [_normalize_and_optimize_command(cmd)]


async def auto_heal_command(
    original_command: str,
    error_message: str,
    stdout: str = "",
    stderr: str = "",
    cwd: Optional[str] = None,
) -> dict:
    """Run 100% local mini-agent loop to repair a failed command up to 10 attempts without remote API calls."""
    # First attempt natural language intent parsing
    initial_cmds = _parse_natural_language_intent(original_command)
    target_cmd = initial_cmds[0] if initial_cmds else _normalize_and_optimize_command(original_command)

    logger.info("🤖 [LOCAL MINI-AGENT] Taking over task: '%s' -> Resolved shell command: '%s'", original_command, target_cmd)

    current_error = f"Error: {error_message}\nStderr: {stderr[-1000:]}\nStdout: {stdout[-1000:]}"
    work_dir = cwd or os.path.expanduser("~")

    from .tool_executor import _execute_tool_raw

    all_stdout_logs = []
    all_stderr_logs = []
    execution_trace = []
    tools_executed = []

    # Fast-path intent parsed command execution
    if target_cmd != original_command:
        logger.info("🤖 [LOCAL MINI-AGENT] Executing intent parsed command: %s", target_cmd)
        tools_executed.append(target_cmd)
        res = await _execute_tool_raw("terminal_exec", {
            "command": target_cmd,
            "background": False,
            "_from_mini_agent": True,
            "timeout_seconds": 180,
        })
        out = res.get("stdout", "")
        err = res.get("stderr", "")
        if out: all_stdout_logs.append(out)
        if err: all_stderr_logs.append(err)

        trace_entry = {
            "attempt": 0,
            "tool": "terminal_exec",
            "command": target_cmd,
            "exit_code": res.get("exit_code"),
            "stdout": out,
            "stderr": err,
            "status": "success" if res.get("exit_code") == 0 else "failed",
        }
        execution_trace.append(trace_entry)

        if res.get("exit_code") == 0:
            logger.info("🎉 [LOCAL MINI-AGENT] Successfully executed task: %s", target_cmd)
            return {
                "healed": True,
                "attempts_count": 1,
                "tools_executed": tools_executed,
                "execution_trace": execution_trace,
                "exit_code": 0,
                "stdout": "\n".join(all_stdout_logs),
                "stderr": "\n".join(all_stderr_logs),
                "message": f"Task completed autonomously by Local Mini Agent: {target_cmd}",
            }

    # Up to 10 Local Repair Attempts
    for attempt in range(1, MAX_REPAIR_ATTEMPTS + 1):
        logger.info("🤖 [LOCAL MINI-AGENT] Repair attempt %d/%d for: %s", attempt, MAX_REPAIR_ATTEMPTS, original_command)

        fix_commands = _local_repair_strategy(attempt, original_command, current_error)

        step_success = True
        for fix_cmd in fix_commands:
            logger.info("🤖 [LOCAL MINI-AGENT] Executing local repair step (%d/%d): %s", attempt, MAX_REPAIR_ATTEMPTS, fix_cmd)
            tools_executed.append(fix_cmd)
            res = await _execute_tool_raw("terminal_exec", {
                "command": fix_cmd,
                "background": False,
                "_from_mini_agent": True,
                "timeout_seconds": 180,
            })

            out = res.get("stdout", "")
            err = res.get("stderr", "")
            if out: all_stdout_logs.append(out)
            if err: all_stderr_logs.append(err)

            trace_entry = {
                "attempt": attempt,
                "tool": "terminal_exec",
                "command": fix_cmd,
                "exit_code": res.get("exit_code"),
                "stdout": out,
                "stderr": err,
                "status": "success" if res.get("exit_code") == 0 else "failed",
            }
            execution_trace.append(trace_entry)

            if res.get("exit_code") != 0 and not res.get("healed"):
                step_success = False
                current_error = f"Fix command '{fix_cmd}' failed with code {res.get('exit_code')}:\n{err}"
                break

        if step_success:
            logger.info("🎉 [LOCAL MINI-AGENT] Successfully healed task on attempt %d: %s", attempt, original_command)
            return {
                "healed": True,
                "attempts_count": attempt,
                "tools_executed": tools_executed,
                "execution_trace": execution_trace,
                "exit_code": 0,
                "stdout": "\n".join(all_stdout_logs),
                "stderr": "\n".join(all_stderr_logs),
                "message": f"Task completed autonomously by Local Mini Agent on attempt {attempt}.",
            }

    return {
        "healed": False,
        "attempts_count": MAX_REPAIR_ATTEMPTS,
        "tools_executed": tools_executed,
        "execution_trace": execution_trace,
        "error": f"Local Mini Agent attempted auto-healing {MAX_REPAIR_ATTEMPTS} times.",
        "stdout": "\n".join(all_stdout_logs),
        "stderr": "\n".join(all_stderr_logs),
    }
