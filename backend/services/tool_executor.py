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
            from .local_model import run_local_mini_agent
            return await run_local_mini_agent(task_prompt)
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
        else:
            return {"error": f"Unknown tool: {name}"}
    except Exception as e:
        logger.exception("Tool %s failed", name)
        return {"error": str(e)}


# --- Terminal ---

async def _terminal_exec(args: dict) -> dict:
    command = args["command"]
    background = args.get("background", True)
    timeout = min(args.get("timeout_seconds", 30), 600)

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
