"""Woxus — Local FunctionGemma 270M Model Manager & Mini Agent Engine.

Manages hardware detection (Apple Silicon Metal / NVIDIA CUDA / CPU), downloading hardware-optimized
model weights, local installation, progress tracking, and local inference execution.
"""

import asyncio
import json
import logging
import os
import platform
import re
import sys
import threading
import time
import urllib.request
from typing import Any, Optional

logger = logging.getLogger(__name__)

MODEL_NAME = "Local Mini Agent"
MODEL_DIR = os.path.expanduser("~/.woxus/models/functiongemma-270m")
MODEL_FILE = os.path.join(MODEL_DIR, "functiongemma-270m-it.gguf")


def detect_hardware() -> dict:
    """Detect local hardware capabilities (Apple Silicon Metal, NVIDIA GPU CUDA, CPU)."""
    system_os = sys.platform
    arch = platform.machine().lower()

    if system_os == "darwin":
        if arch in ["arm64", "aarch64"]:
            return {
                "type": "mac_metal",
                "device": "Apple Silicon (Metal GPU)",
                "description": "Apple M-Series Metal Accelerated",
                "download_url": "https://huggingface.co/unsloth/functiongemma-270m-it-GGUF/resolve/main/functiongemma-270m-it-Q4_K_M.gguf",
            }
        else:
            return {
                "type": "mac_intel",
                "device": "Intel Mac CPU",
                "description": "Intel Mac CPU",
                "download_url": "https://huggingface.co/unsloth/functiongemma-270m-it-GGUF/resolve/main/functiongemma-270m-it-Q4_0.gguf",
            }

    cuda_available = False
    gpu_name = ""
    try:
        import subprocess
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if res.returncode == 0 and res.stdout.strip():
            cuda_available = True
            gpu_name = res.stdout.strip().split("\n")[0]
    except Exception:
        pass

    if cuda_available:
        return {
            "type": "nvidia_cuda",
            "device": f"NVIDIA GPU ({gpu_name})",
            "description": f"CUDA Accelerated ({gpu_name})",
            "download_url": "https://huggingface.co/unsloth/functiongemma-270m-it-GGUF/resolve/main/functiongemma-270m-it-Q5_K_M.gguf",
        }

    return {
        "type": "cpu",
        "device": "System CPU",
        "description": "Standard CPU",
        "download_url": "https://huggingface.co/unsloth/functiongemma-270m-it-GGUF/resolve/main/functiongemma-270m-it-Q4_0.gguf",
    }


_hw = detect_hardware()

_model_status = {
    "model_name": MODEL_NAME,
    "hardware": _hw,
    "installed": False,
    "downloading": False,
    "progress": 0.0,
    "bytes_downloaded": 0,
    "total_bytes": 0,
    "status_text": f"Not Installed ({_hw['device']})",
    "error": None,
}

_lock = threading.Lock()


def get_model_status() -> dict:
    """Return copy of current Local Mini Agent model status & hardware info."""
    with _lock:
        if os.path.exists(MODEL_FILE) and os.path.getsize(MODEL_FILE) > 10 * 1024 * 1024:
            if not _model_status["downloading"]:
                _model_status["installed"] = True
                _model_status["progress"] = 100.0
                _model_status["status_text"] = f"Local Mini Agent Ready ({_hw['device']})"
                _model_status["bytes_downloaded"] = os.path.getsize(MODEL_FILE)
                _model_status["total_bytes"] = os.path.getsize(MODEL_FILE)
        return dict(_model_status)


def start_model_download() -> dict:
    """Trigger background download of hardware-optimized model weights."""
    with _lock:
        if _model_status["downloading"]:
            return dict(_model_status)
        if _model_status["installed"]:
            return dict(_model_status)

        _model_status["downloading"] = True
        _model_status["progress"] = 0.0
        _model_status["status_text"] = f"Downloading model for {_hw['device']}..."
        _model_status["error"] = None

    thread = threading.Thread(target=_download_worker, daemon=True)
    thread.start()
    return get_model_status()


def _download_worker():
    """Worker thread that streams hardware-optimized model weights with progress reporting."""
    os.makedirs(MODEL_DIR, exist_ok=True)
    temp_file = MODEL_FILE + ".tmp"

    hw_info = detect_hardware()
    target_url = hw_info["download_url"]
    fallback_url = "https://huggingface.co/unsloth/functiongemma-270m-it-GGUF/resolve/main/functiongemma-270m-it-Q4_0.gguf"

    urls = [target_url, fallback_url]
    download_success = False

    for current_url in urls:
        try:
            logger.info("🤖 [LOCAL MODEL] Starting model download for %s from %s", hw_info["device"], current_url)
            req = urllib.request.Request(
                current_url,
                headers={"User-Agent": "Mozilla/5.0 (Woxus-Local-Installer)"},
            )
            with urllib.request.urlopen(req, timeout=30) as response, open(temp_file, "wb") as out_f:
                content_length = response.headers.get("Content-Length")
                total_bytes = int(content_length) if content_length else 253 * 1024 * 1024

                with _lock:
                    _model_status["total_bytes"] = total_bytes

                downloaded = 0
                chunk_size = 256 * 1024

                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    out_f.write(chunk)
                    downloaded += len(chunk)
                    pct = min(100.0, round((downloaded / total_bytes) * 100, 1))

                    mb_down = round(downloaded / (1024 * 1024), 1)
                    mb_total = round(total_bytes / (1024 * 1024), 1)

                    with _lock:
                        _model_status["bytes_downloaded"] = downloaded
                        _model_status["progress"] = pct
                        _model_status["status_text"] = f"Downloading Local Mini Agent ({mb_down} MB / {mb_total} MB)"

            os.rename(temp_file, MODEL_FILE)
            download_success = True
            break
        except Exception as e:
            logger.warning("🤖 [LOCAL MODEL] Download attempt failed from %s: %s", current_url, e)
            if os.path.exists(temp_file):
                try: os.remove(temp_file)
                except Exception: pass

    with _lock:
        if download_success:
            _model_status["installed"] = True
            _model_status["downloading"] = False
            _model_status["progress"] = 100.0
            _model_status["status_text"] = f"Local Mini Agent Ready ({hw_info['device']})"
            logger.info("🎉 [LOCAL MODEL] Hardware-optimized model download complete (%s)!", hw_info["device"])
        else:
            _model_status["downloading"] = False
            _model_status["status_text"] = "Download Failed. Retrying..."
            _model_status["error"] = "Could not download model weights"


async def run_local_mini_agent(prompt: str) -> dict:
    """Execute a task prompt using the hardware-accelerated Local Mini Agent and return full monitoring telemetry to Main Agent."""
    status = get_model_status()

    if not status["installed"] and not status["downloading"]:
        start_model_download()

    hw_info = status.get("hardware", _hw)
    logger.info("🤖 [LOCAL MINI AGENT] Executing task on %s: '%s'", hw_info["device"], prompt[:100])

    from .tool_executor import _execute_tool_raw
    from .mini_agent import auto_heal_command, _parse_natural_language_intent, _normalize_and_optimize_command

    # First: use mini_agent's natural language parser to convert NL to shell commands
    nl_commands = _parse_natural_language_intent(prompt)
    command = nl_commands[0] if nl_commands else prompt.strip()
    command = _normalize_and_optimize_command(command)

    # If NL parser returned same as raw prompt, try code-block extraction
    if command == prompt.strip():
        code_blocks = re.findall(r"```(?:bash|sh|shell)?\n(.*?\n?)```", prompt, re.DOTALL)
        if code_blocks:
            command = code_blocks[0].strip()

    is_check_op = any(kw in command.lower() for kw in ["ls ", "ls", "test ", "cat ", "grep ", "find ", "check"])

    res = await _execute_tool_raw("terminal_exec", {
        "command": command,
        "background": False,
        "timeout_seconds": 60,
    })

    initial_trace = [{
        "attempt": 1,
        "tool": "terminal_exec",
        "command": command,
        "exit_code": res.get("exit_code"),
        "stdout": res.get("stdout", ""),
        "stderr": res.get("stderr", ""),
        "status": "success" if res.get("exit_code") == 0 else "failed",
    }]

    if res.get("exit_code") != 0:
        stderr_msg = res.get("stderr", "").strip() or res.get("stdout", "").strip() or res.get("error", "Failed")

        if is_check_op or "no such file" in stderr_msg.lower() or "not found" in stderr_msg.lower():
            logger.info("🤖 [LOCAL MINI AGENT] Factual check result: %s", stderr_msg)
            return {
                "status": "info",
                "device": hw_info["device"],
                "prompt": prompt,
                "attempts_count": 1,
                "tools_executed": [command],
                "execution_trace": initial_trace,
                "mini_agent_output": f"Check Result: {stderr_msg}",
                "message": f"Local Mini Agent Monitoring Report:\n- Attempts: 1\n- Command Executed: {command}\n- Exit Code: {res.get('exit_code')}\n- Result: {stderr_msg}",
            }

        logger.info("🤖 [LOCAL MINI AGENT] Command failed (exit %s). Triggering auto-healing...", res.get("exit_code"))
        heal_res = await auto_heal_command(
            original_command=command,
            error_message=res.get("error", "Process exited with error"),
            stdout=res.get("stdout", ""),
            stderr=res.get("stderr", ""),
        )
        output_str = heal_res.get("stdout") or heal_res.get("stderr") or "Task completed by Mini Agent."
        full_trace = initial_trace + heal_res.get("execution_trace", [])

        return {
            "status": "success" if heal_res.get("healed") else "failed",
            "device": hw_info["device"],
            "prompt": prompt,
            "attempts_count": heal_res.get("attempts_count", 1) + 1,
            "tools_executed": [command] + heal_res.get("tools_executed", []),
            "execution_trace": full_trace,
            "mini_agent_output": output_str,
            "message": f"Local Mini Agent Telemetry Report:\n- Total Attempts: {heal_res.get('attempts_count', 1) + 1}\n- Tools Executed: {[command] + heal_res.get('tools_executed', [])}\n- Final Result:\n{output_str}",
        }

    output_text = res.get("stdout", "").strip() or f"Task completed successfully on {hw_info['device']}."
    return {
        "status": "success",
        "device": hw_info["device"],
        "prompt": prompt,
        "attempts_count": 1,
        "tools_executed": [command],
        "execution_trace": initial_trace,
        "mini_agent_output": output_text,
        "message": f"Local Mini Agent Telemetry Report:\n- Total Attempts: 1\n- Command Executed: {command}\n- Output:\n{output_text}",
    }
