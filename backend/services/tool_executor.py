"""Woxus — Executes tool calls from Gemini Live API.

Maps function names from toolCall to actual implementations.
Runs terminal commands, reads/writes files, manages memories.
"""

import asyncio
import json
import logging
import os
import time
from typing import Any, Optional

from .file_writer import read_text_file
from .file_writer import write_file as write_file_svc
from .memory_engine import create_memory, list_memories
from .memory_engine import delete_memory as delete_memory_svc
from .task_manager import get_task_manager

logger = logging.getLogger(__name__)

DANGEROUS_KEYWORDS = [
    "rm -rf /", "sudo ", "mkfs.", "dd if=", "> /dev/",
    ":(){ :|:& };:", "chmod 777 /", "wget ",
    "curl ", "nc -e ", "bash -i ",
]

# Known shell tools/executables. A command that doesn't start with one of
# these (and isn't a path/flag/env-assignment) is natural-language text — it
# must NOT be executed as a shell command (was causing exit-2 failures and an
# infinite auto-heal loop when the mini-agent passed English sentences).
_SHELL_START = (
    "ls", "cd", "mkdir", "npx", "npm", "pnpm", "yarn", "python", "python3",
    "node", "git", "cat", "pwd", "rm", "touch", "curl", "wget", "brew",
    "open", "find", "echo", "sudo", "kill", "ps", "top", "df", "du",
    "chmod", "cp", "mv", "sh", "bash", "zsh", "grep", "sed", "awk",
    "tar", "unzip", "zip", "make", "cmake", "docker", "kubectl", "code",
    "pip", "pip3", "defaults", "osascript", "plutil", "source", "export",
)


# Common English words that follow a tool name in a sentence ("find and open",
# "open the PRD") — a real command never has these as its second token.
_ENGLISH_WORDS = {
    "and", "the", "to", "a", "for", "of", "me", "please", "i", "you",
    "in", "on", "this", "that", "open", "read", "make", "create", "write",
    "find", "check", "list", "show", "tell", "my", "your", "from", "with",
    "new", "then", "is", "are", "it", "can", "will", "do", "we",
}


def _looks_like_shell_command(cmd: str) -> bool:
    """Heuristic: a real command starts with a known tool, a path, a flag, or an
    env assignment. English sentences ("Find and read the PRD...", "open the PRD")
    are NOT commands and must never run as one."""
    cmd = (cmd or "").strip()
    if not cmd:
        return False
    words = cmd.split()
    first = words[0].lstrip("\"'").rstrip(";").lower()
    # path / flag / env-assignment → command
    if first.startswith(("./", "/", "~", "-")) or (
        "=" in first and not first.startswith(("=", "=="))
    ):
        return True
    if first in _SHELL_START:
        # Known tool: but "find and open the document..." is English, not `find`.
        # A real command's next token is a path/flag/option, not a sentence word.
        if len(words) > 1:
            second = words[1].lstrip("\"'-").rstrip(";,").lower()
            if second in _ENGLISH_WORDS:
                return False
        return True
    return False


ALLOWED_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css",
    ".json", ".txt", ".md", ".yaml", ".yml", ".toml",
    ".env", ".gitignore", ".sh", ".bat", ".ps1",
    ".sql", ".xml", ".svg", ".cfg", ".ini",
    ".cjs", ".mjs", ".mts", ".cts",
}


def _check_dangerous(command: str) -> str | None:
    cmd_lower = command.lower()
    for kw in DANGEROUS_KEYWORDS:
        if kw in cmd_lower:
            return f"Command blocked: contains dangerous pattern '{kw}'"
    return None


def _expand_path(path: str) -> str:
    return os.path.abspath(os.path.expanduser(path))


async def handle_tool_call(name: str, args: dict) -> dict:
    """Execute a tool function and return the response dict."""
    logger.info("Tool call: %s args=%s", name, args)

    try:
        if name == "delegate_task_to_mini_agent":
            task_prompt = str(args.get("task_prompt") or "").strip()
            # Guard against spurious re-delegation: Gemini sometimes re-calls
            # this tool with the mini agent's output as the "task_prompt" (e.g.
            # {'output': {...}}). That's not a real task — reject it so we don't
            # run an empty mini-agent job.
            if not task_prompt or "output" in args:
                logger.info("Skipping empty/malformed delegation (task_prompt=%r)", task_prompt[:60])
                return {
                    "status": "skipped",
                    "message": "Task already completed — nothing to delegate.",
                }
            return await _delegate_single(task_prompt, args.get("label"))
        elif name == "delegate_tasks_to_mini_agent":
            return await _delegate_fan_out(args)
        elif name == "mini_task_status":
            return _mini_task_status(args)
        elif name == "mini_task_list":
            return _mini_task_list(args)
        elif name == "terminal_exec":
            return await _terminal_exec(args)
        elif name == "terminal_status":
            return _terminal_status(args)
        elif name == "terminal_list_tasks":
            return _terminal_list()
        elif name == "write_file":
            return await _write_file(args)
        elif name == "read_file":
            return await _read_file(args)
        elif name == "list_directory":
            return _list_dir(args)
        elif name == "write_to_focused_input":
            return _write_to_focused_input(args)
        elif name == "memory_create":
            return await _memory_create(args)
        elif name == "memory_list":
            return _memory_list(args)
        elif name == "memory_delete":
            return _memory_delete(args)
        elif name == "whatsapp_send":
            return await _whatsapp_send(args)
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as e:
        logger.exception("Tool %s failed", name)
        return {"error": str(e)}


# --- Mini-agent delegation (parallel registry) ---

def submit_delegation(task_prompt: str, label: str | None = None):
    """Register a mini task and return it immediately (runs in background).
    The caller awaits it later via await_mini_task(task_id)."""
    from .mini_tasks import get_mini_task_manager

    return get_mini_task_manager().submit(label or task_prompt[:60], task_prompt, _run_mini_task)


async def _run_mini_task(task) -> dict:
    """Runner executed inside the mini-task semaphore slot."""
    from .local_model import run_local_mini_agent

    return await run_local_mini_agent(task.prompt)


async def _delegate_single(task_prompt: str, label: str | None = None, timeout: float | None = 300) -> dict:
    """Register a mini task and wait for it. Direct callers (overlay) block;
    the voice path submits first and awaits in background so speech stays free."""
    from .mini_tasks import await_mini_task

    task = submit_delegation(task_prompt, label)
    res = await await_mini_task(task.task_id, timeout=timeout)
    res["mini_task_id"] = task.task_id
    return res


async def _delegate_fan_out(args: dict) -> dict:
    """Run several independent mini-agent tasks concurrently (bounded by the
    mini-task cap; overflow waits queued). Returns per-task results."""
    from .mini_tasks import await_mini_task, get_mini_task_manager

    items = args.get("tasks") or []
    if not isinstance(items, list) or not items:
        return {"error": "tasks must be a non-empty list of {label, task_prompt}"}
    items = items[:50]
    timeout = min(float(args.get("timeout_seconds", 300)), 900)

    mgr = get_mini_task_manager()
    submitted = []
    for item in items:
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("task_prompt", "") or "").strip()
        if not prompt or "output" in item:
            continue
        label = str(item.get("label", "") or prompt[:60])
        submitted.append(mgr.submit(label, prompt, _run_mini_task))
    if not submitted:
        return {"error": "no valid tasks (need task_prompt per item)"}

    results = await asyncio.gather(*[await_mini_task(t.task_id, timeout=timeout) for t in submitted])
    done = sum(1 for t in submitted if mgr.get(t.task_id) and mgr.get(t.task_id).state == "done")
    return {
        "status": "done",
        "completed": done,
        "total": len(submitted),
        "tasks": [
            {"mini_task_id": t.task_id, "label": t.label, **r}
            for t, r in zip(submitted, results)
        ],
    }


def _mini_task_status(args: dict) -> dict:
    from .mini_tasks import get_mini_task_manager

    task = get_mini_task_manager().get(str(args.get("task_id", "")))
    if not task:
        return {"error": f"No mini task found: {args.get('task_id')}"}
    d = task.to_dict()
    d["result"] = task.result
    return d


def _mini_task_list(args: dict) -> dict:
    from .mini_tasks import get_mini_task_manager

    tasks = get_mini_task_manager().list()[:20]
    return {"tasks": [t.to_dict() for t in tasks], "count": len(tasks)}


# --- Terminal ---

async def _terminal_exec(args: dict) -> dict:
    command = args["command"]
    background = args.get("background", True)
    timeout = min(args.get("timeout_seconds", 30), 600)

    # Never run natural-language text as a shell command (stops the infinite
    # auto-heal loop + "not understanding" behaviour).
    if not _looks_like_shell_command(command):
        return {
            "error": (
                f"Not a terminal command: '{str(command)[:80]}'. "
                "Give a real command like `ls` or `mkdir project`, not a description."
            ),
            "exit_code": -1,
        }

    danger = _check_dangerous(command)
    if danger:
        return {"error": danger}

    # Register EVERY command in task_manager so it appears live in the Tasks UI!
    tm = get_task_manager()
    task = await tm.start(command)

    if background:
        return {
            "task_id": task.task_id,
            "state": "running",
            "message": f"Background task {task.task_id} started",
            "command": command,
        }

    # Foreground execution: Wait for task to finish while streaming logs to task_manager
    start_t = time.time()
    while task.state == "running":
        if (time.time() - start_t) > timeout:
            return {
                "exit_code": -1,
                "stdout": task.stdout,
                "stderr": task.stderr + f"\nTimed out after {timeout} seconds.",
                "timed_out": True,
            }
        await asyncio.sleep(0.2)

    return {
        "exit_code": task.exit_code,
        "stdout": task.stdout,
        "stderr": task.stderr,
        "timed_out": False,
        "healed": task.state == "done" and "Auto-Healed" in task.stdout,
    }


async def _execute_tool_raw(name: str, args: dict) -> dict:
    """Execute tool directly without triggering recursive mini-agent loops."""
    args["_from_mini_agent"] = True
    return await handle_tool_call(name, args)


def _terminal_status(args: dict) -> dict:
    tm = get_task_manager()
    task = tm.get(args["task_id"])
    if not task:
        return {"error": f"No task found: {args['task_id']}"}
    return task.to_dict()


def _terminal_list() -> dict:
    tm = get_task_manager()
    tasks = tm.list()
    return {
        "tasks": [t.to_dict() for t in tasks[:20]],
        "count": len(tasks),
    }


# --- File operations ---

async def _write_file(args: dict) -> dict:
    path = _expand_path(args["filepath"])
    content = args["content"]

    ext = os.path.splitext(path)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {
            "error": f"Extension '{ext}' not allowed. "
                     f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        }

    try:
        result = write_file_svc(path, content)
        if "error" in result:
            return result
        return {"success": True, "path": result["path"], "bytes": result["size"]}
    except Exception as e:
        return {"error": str(e)}


async def _read_file(args: dict) -> dict:
    path = _expand_path(args["filepath"])
    try:
        content = await read_text_file(path)
        return {"success": True, "path": path, "content": content}
    except Exception as e:
        return {"error": str(e)}


def _list_dir(args: dict) -> dict:
    path = _expand_path(args.get("path", "~"))
    try:
        entries = sorted(os.listdir(path))
        items = []
        for name in entries:
            full = os.path.join(path, name)
            items.append({
                "name": name,
                "type": "dir" if os.path.isdir(full) else "file",
                "size": os.path.getsize(full) if os.path.isfile(full) else None,
            })
        return {"success": True, "path": path, "items": items, "count": len(items)}
    except Exception as e:
        return {"error": str(e)}


# --- Prompt Writer ---

def _write_to_focused_input(args: dict) -> dict:
    """Return a paste payload — the Electron side pastes it at the cursor."""
    text = str(args.get("text") or "").strip()
    if not text:
        return {"error": "No text provided to write"}
    return {"action": "paste", "text": text, "ok": True}


# --- WhatsApp (wacli + NLP resolver) ---

async def _whatsapp_send(args: dict) -> dict:
    to_raw = str(args.get("to_raw", args.get("to", "")) or "").strip()
    message = str(args.get("message", "") or "").strip()
    pick = args.get("pick")
    if not to_raw or not message:
        return {"error": "to_raw and message required"}
    try:
        from .whatsapp_contacts import resolve_contact
        from . import whatsapp as wa
    except Exception as e:
        return {"error": f"whatsapp backend unavailable: {e}"}

    # explicit pick path — send at once
    if pick is not None:
        preview = resolve_contact(to_raw)
        cands = preview.get("candidates", [])
        try:
            chosen = cands[int(pick)]
            to_send = chosen.get("phone", to_raw)
        except Exception:
            return {"error": "invalid pick index", "candidates": cands}
        res = await wa.send_text_async(to_send, message)
        if isinstance(res, dict):
            res["matched"] = chosen.get("name", to_send)
        return res

    resolved = resolve_contact(to_raw)
    status = resolved.get("status")
    if status in ("exact", "fuzzy", "phone"):
        to_send = resolved.get("phone", to_raw)
        res = await wa.send_text_async(to_send, message)
        if isinstance(res, dict):
            res["nlp_score"] = resolved.get("score")
            res["matched"] = resolved.get("matched", to_send)
        return res
    if status == "ambiguous":
        return {"status": "needs_pick", "candidates": resolved.get("candidates", []), "score": resolved.get("score")}
    return {"status": "unknown_recipient", "to_raw": to_raw, "candidates": resolved.get("candidates", [])}


# --- Memory ---

async def _memory_create(args: dict) -> dict:
    try:
        importance = min(max(args.get("importance", 3) / 5.0, 0.1), 1.0)
        tags = [t.strip() for t in args.get("tags", "").split(",") if t.strip()]
        category = tags[0] if tags else "general"
        memory = create_memory(
            category=category,
            content=args["content"],
            importance=importance,
        )
        return {"success": True, "memory": memory}
    except Exception as e:
        return {"error": str(e)}


def _memory_list(args: dict) -> dict:
    memories = list_memories()
    limit = min(args.get("limit", 20), 100)
    return {"memories": memories[:limit], "count": len(memories)}


def _memory_delete(args: dict) -> dict:
    success = delete_memory_svc(args["id"])
    return {"success": success}
