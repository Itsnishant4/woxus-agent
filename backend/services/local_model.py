"""Woxus — Local SmolLM3 3B Model Manager & Mini Agent Engine.

Manages hardware detection (Apple Silicon Metal / NVIDIA CUDA / CPU), downloading hardware-optimized
model weights, local installation, progress tracking, and local inference execution.
"""

import asyncio
import logging
import os
import platform
import re
import sys
import threading
import ssl
import urllib.request

# --- TLS trust bootstrap --------------------------------------------------
# python.org macOS builds (incl. Python 3.14) ship without a CA bundle wired
# into the stdlib `ssl` module, so HTTPS via urllib.request fails with:
#   [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
#   unable to get local issuer certificate
# certifi is installed in this venv (transitive dependency), so we point the
# stdlib ssl contexts at it and build an explicit context to hand to urlopen.
try:
    import certifi as _certifi  # noqa: N812
    _ssl_cafile = _certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", _ssl_cafile)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", _ssl_cafile)
    os.environ.setdefault("CURL_CA_BUNDLE", _ssl_cafile)
    _SSL_CONTEXT = ssl.create_default_context(cafile=_ssl_cafile)
except Exception:  # certifi unavailable / no CA bundle yet
    _SSL_CONTEXT = ssl.create_default_context()

logger = logging.getLogger(__name__)

MODEL_NAME = "Woxus Agent (SmolLM3 3B)"
MODEL_DIR = os.path.expanduser("~/.woxus/models/smollm3-3b")
MODEL_FILE = os.path.join(MODEL_DIR, "SmolLM3-3B-Q4_K_M.gguf")
MODEL_BYTES = 1915305312  # Ollama blob size (alibayram/smollm3 Q4_K_M)

# Sole download source: Ollama registry (fast CDN, Asia-friendly)
_OLLAMA_URL = "https://registry.ollama.ai/v2/alibayram/smollm3/blobs/sha256-048b986bb243c09b5410fc9f73bdc5bf749bf8e24e1a703ca830c1b29b0267f8"


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
                "download_url": _OLLAMA_URL,
            }
        else:
            return {
                "type": "mac_intel",
                "device": "Intel Mac CPU",
                "description": "Intel Mac CPU",
                "download_url": _OLLAMA_URL,
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
            "download_url": _OLLAMA_URL,
        }

    return {
        "type": "cpu",
        "device": "System CPU",
        "description": "Standard CPU",
        "download_url": _OLLAMA_URL,
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


def _model_file_for(hw_info: dict) -> str:
    """Resolve the model file path (fixed name — blob URLs carry hash basenames)."""
    return MODEL_FILE


def get_model_status() -> dict:
    """Return copy of current Local Mini Agent model status & hardware info."""
    with _lock:
        installed_file = _model_file_for(_hw)
        if os.path.exists(installed_file) and os.path.getsize(installed_file) > 10 * 1024 * 1024:
            if not _model_status["downloading"]:
                _model_status["installed"] = True
                _model_status["progress"] = 100.0
                _model_status["status_text"] = f"Local Mini Agent Ready ({_hw['device']})"
                _model_status["bytes_downloaded"] = os.path.getsize(installed_file)
                _model_status["total_bytes"] = os.path.getsize(installed_file)
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


def _parallel_download(url: str, dest: str, total_bytes: int, streams: int = 6) -> bool:
    """Stdlib-only parallel downloader with RESUME support.

    `streams` concurrent Range requests write to part files, then concatenated
    in order. If a stream fails, the parts already downloaded are KEPT so a
    retry can resume from where it left off (progress never resets to 0).
    """
    import threading as _t

    part_files = [f"{dest}.p{i}" for i in range(streams)]
    ok = [False] * streams
    chunk_size = (total_bytes + streams - 1) // streams

    def _worker(i: int):
        part = part_files[i]
        # Resume: if a partial file already exists from a previous attempt,
        # continue from its current size instead of restarting the stream.
        resume_at = 0
        try:
            if os.path.exists(part):
                resume_at = os.path.getsize(part)
        except Exception:
            pass
        start = i * chunk_size + resume_at
        end = min((i + 1) * chunk_size - 1, total_bytes - 1)
        if resume_at >= end - start + 1 or start > end:
            ok[i] = True
            return
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Range": f"bytes={start}-{end}",
                    "User-Agent": "Mozilla/5.0 (Woxus-Local-Installer)",
                },
            )
            with urllib.request.urlopen(req, timeout=60, context=_SSL_CONTEXT) as resp, open(part, "ab") as out_f:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    out_f.write(chunk)
            ok[i] = True
        except Exception as e:
            logger.warning("🤖 [LOCAL MODEL] Parallel stream %d failed (resume@%d): %s", i, resume_at, e)

    threads = [_t.Thread(target=_worker, args=(i,), daemon=True) for i in range(streams)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # If any stream failed, KEEP the partials so the next attempt resumes.
    if not all(ok):
        return False

    with open(dest, "wb") as out_f:
        for p in part_files:
            with open(p, "rb") as in_f:
                while True:
                    chunk = in_f.read(1 << 22)
                    if not chunk:
                        break
                    out_f.write(chunk)
    for p in part_files:
        try: os.remove(p)
        except Exception: pass
    return os.path.getsize(dest) == total_bytes


def _download_worker():
    """Worker thread that downloads the model from the Ollama registry using
    parallel Range streams, reporting live progress to the UI."""
    os.makedirs(MODEL_DIR, exist_ok=True)

    hw_info = detect_hardware()
    target_url = hw_info["download_url"]
    target_file = _model_file_for(hw_info)
    temp_file = target_file + ".tmp"

    download_success = False

    # Fast path: parallel Range download from the Ollama registry (fast, no HF).
    # Set total_bytes FIRST so the UI shows "0 / 200 MB" immediately, not
    # "Preparing…" while we wait for the HEAD request.
    total_bytes = MODEL_BYTES
    with _lock:
        _model_status["total_bytes"] = total_bytes
        _model_status["bytes_downloaded"] = 0
        _model_status["progress"] = 0.0
        _model_status["status_text"] = f"Downloading Local Mini Agent (0.0 MB / {round(total_bytes/1024/1024,1)} MB)"
    try:
        req = urllib.request.Request(target_url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30, context=_SSL_CONTEXT) as resp:
            total_bytes = int(resp.headers.get("Content-Length") or 0) or MODEL_BYTES
            with _lock:
                _model_status["total_bytes"] = total_bytes
    except Exception:
        pass

    import threading as _t
    stop = _t.Event()

    def _on_disk_bytes() -> int:
        size = 0
        try:
            if os.path.exists(temp_file):
                size += os.path.getsize(temp_file)
            for i in range(6):
                part = f"{temp_file}.p{i}"
                if os.path.exists(part):
                    size += os.path.getsize(part)
        except Exception:
            pass
        return size

    # Never let progress go backward: keep the highest bytes seen. During the
    # concat/rename phase parts disappear (bytes dip), but the UI should only
    # ever move forward toward 100%.
    peak_bytes = 0

    def _progress_poller():
        nonlocal peak_bytes
        while not stop.is_set():
            try:
                on_disk = _on_disk_bytes()
                peak_bytes = max(peak_bytes, on_disk)
                pct = min(100.0, round((peak_bytes / total_bytes) * 100, 1)) if total_bytes else 0.0
                with _lock:
                    _model_status["bytes_downloaded"] = peak_bytes
                    _model_status["progress"] = pct
                    mb_down = round(peak_bytes / (1024 * 1024), 1)
                    mb_total = round(total_bytes / (1024 * 1024), 1)
                    _model_status["status_text"] = f"Downloading Local Mini Agent ({mb_down} MB / {mb_total} MB)"
            except Exception:
                pass
            stop.wait(1.0)

    poller = _t.Thread(target=_progress_poller, daemon=True)
    poller.start()
    try:
        if total_bytes > 0 and _parallel_download(target_url, temp_file, total_bytes, streams=6):
            os.rename(temp_file, target_file)
            download_success = True
            logger.info("🤖 [LOCAL MODEL] Parallel download complete (Ollama registry): %s", target_file)
    except Exception as e:
        logger.warning("🤖 [LOCAL MODEL] Ollama parallel download failed: %s", e)
    finally:
        stop.set()

    if not download_success and os.path.exists(target_file):
        try: os.remove(target_file)
        except Exception: pass

    if download_success:
        with _lock:
            _model_status["installed"] = True
            _model_status["downloading"] = False
            _model_status["progress"] = 100.0
            _model_status["status_text"] = f"Local Mini Agent Ready ({hw_info['device']})"
            logger.info("🎉 [LOCAL MODEL] Hardware-optimized model download complete (%s)!", hw_info["device"])
        return

    with _lock:
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

    from .mini_agent import (
        _SHELL_KEYWORDS,
        _normalize_and_optimize_command,
        auto_heal_command,
    )
    from .tool_executor import _execute_tool_raw

    # Direct shell command (e.g. "pwd", "ls -la") — execute as-is without AI
    code_blocks = re.findall(r"```(?:bash|sh|shell)?\n(.*?\n?)```", prompt, re.DOTALL)
    if code_blocks:
        prompt = code_blocks[0].strip()

    first_word = prompt.strip().split()[0].lower() if prompt.strip() else ""
    direct_cmd = first_word in _SHELL_KEYWORDS or any(f" {kw} " in f" {prompt} " for kw in _SHELL_KEYWORDS)

    # Direct "type/paste the prompt: 'X'" request — type it immediately instead
    # of running the slow agentic loop (~seconds of local inference). The
    # frontend receives action='paste' and types it via nut.js right away.
    # A "TYPE_TEXT:" task from the main agent must ALWAYS be typed, never
    # reasoned about or answered with text.
    if prompt.strip().upper().startswith("TYPE_TEXT:"):
        forced = prompt.split(":", 1)[1].strip()
        if forced:
            logger.info("🤖 [LOCAL MINI AGENT] Forced type task: %r", forced[:60])
            res = await _execute_tool_raw("write_to_focused_input", {
                "text": forced,
                "_from_mini_agent": True,
            })
            if res.get("ok"):
                return {
                    "status": "success",
                    "device": hw_info["device"],
                    "prompt": prompt,
                    "attempts_count": 1,
                    "tools_executed": [f"write_to_focused_input: {forced[:40]}"],
                    "execution_trace": [],
                    "action": "paste",
                    "text": forced,
                    "mini_agent_output": res.get("text") or "Typed into focused input.",
                    "message": res.get("text") or "Typed into focused input.",
                }

    if not direct_cmd and re.search(r"^(?:please\s+)?(?:type|paste|write|enter)\b", prompt, re.IGNORECASE):
        quoted = re.findall(r"[`'\"]\s*([^`'\"]+?)\s*[`'\"]", prompt)
        text = quoted[-1].strip() if quoted else ""
        if not text:
            after_colon = re.search(r":\s*(.+?)\s*$", prompt)
            text = after_colon.group(1).strip().strip("'\"`") if after_colon else ""
        if text and len(text) < 2000:
            logger.info("🤖 [LOCAL MINI AGENT] Direct type request: %r", text[:60])
            res = await _execute_tool_raw("write_to_focused_input", {
                "text": text,
                "_from_mini_agent": True,
            })
            if res.get("ok"):
                return {
                    "status": "success",
                    "device": hw_info["device"],
                    "prompt": prompt,
                    "attempts_count": 1,
                    "tools_executed": [f"write_to_focused_input: {text[:40]}"],
                    "execution_trace": [],
                    "action": "paste",
                    "text": text,
                    "mini_agent_output": res.get("text") or "Typed into focused input.",
                    "message": res.get("text") or "Typed into focused input.",
                }

    # WhatsApp deterministic preview (mini agent has no history, so affirmations
    # complete in the overlay/voice layer — here we only produce the preview).
    try:
        _wa_parsed = _parse_whatsapp_request(prompt)
    except Exception:
        _wa_parsed = None
    if _wa_parsed and not direct_cmd:
        try:
            _wa_handled = await _handle_whatsapp_prompt(prompt, None, hw_info)
            if _wa_handled is not None:
                return _wa_handled
        except Exception as e:
            logger.warning("🤖 [LOCAL MINI AGENT] WhatsApp fast-path failed: %s", e)

    if not direct_cmd:
        # Agentic loop: AI reasons → calls tools → sees results → answers
        from .nano_inference import AGENT_PROMPT, agent_step, is_model_ready
        if not is_model_ready():
            return {
                "status": "info",
                "device": hw_info["device"],
                "prompt": prompt,
                "attempts_count": 0,
                "tools_executed": [],
                "execution_trace": [],
                "mini_agent_output": "I'm still setting up. Please try again in a moment.",
                "message": "I'm still setting up. Please try again in a moment.",
            }

        import json as _json

        messages = [
            {"role": "system", "content": AGENT_PROMPT},
            {"role": "user", "content": prompt},
        ]
        tools_executed: list = []
        execution_trace: list = []
        last_result = ""

        for step in range(1, 6):
            decision = await asyncio.to_thread(agent_step, messages)
            action = (decision or {}).get("action")

            if action == "answer":
                reply = str(decision.get("reply") or "").strip() or f"Got it: \"{prompt}\"."
                logger.info("🤖 [LOCAL MINI AGENT] Agent answered after %d step(s) for '%s'", step, prompt[:50])
                return {
                    "status": "info" if not tools_executed else "success",
                    "device": hw_info["device"],
                    "prompt": prompt,
                    "attempts_count": step,
                    "tools_executed": tools_executed,
                    "execution_trace": execution_trace,
                    "mini_agent_output": reply,
                    "message": reply,
                }

            if action == "tool":
                tool_name = str((decision or {}).get("tool") or "terminal")
                args = (decision or {}).get("args") or {}
                if tool_name == "whatsapp_send":
                    wa_args = {
                        "to_raw": str(args.get("to_raw", args.get("to", "")) or ""),
                        "message": str(args.get("message", "") or ""),
                        "confirm": bool(args.get("confirm", False)),
                    }
                    if args.get("pick") is not None:
                        wa_args["pick"] = args.get("pick")
                    tools_executed.append(f"whatsapp_send: {wa_args['to_raw'][:40]}")
                    res = await _execute_tool_raw("whatsapp_send", dict(wa_args, _from_mini_agent=True))
                    last_result = res.get("message") or res.get("error") or str(res)[:500]
                    execution_trace.append({
                        "attempt": step,
                        "tool": "whatsapp_send",
                        "command": wa_args["to_raw"][:80],
                        "exit_code": 0 if res.get("status") in ("sent", "needs_confirm", "needs_pick") else 1,
                        "stdout": last_result,
                        "stderr": "",
                        "status": "success" if res.get("status") in ("sent", "needs_confirm", "needs_pick") else "failed",
                    })
                    messages.append({"role": "assistant", "content": _json.dumps(decision or {})})
                    messages.append({"role": "user", "content": f"Tool whatsapp_send result:\n{last_result}\nAnswer the user now using this result."})
                    continue
                if tool_name == "write_to_focused_input":
                    text = str(args.get("text") or "").strip()
                    if not text:
                        messages.append({"role": "assistant", "content": _json.dumps(decision or {})})
                        messages.append({"role": "user", "content": "That write_to_focused_input call was empty. Provide the exact text."})
                        continue
                    tools_executed.append(f"write_to_focused_input: {text[:40]}")
                    logger.info("🤖 [LOCAL MINI AGENT] Writing to focused input (%d/5)", step)
                    res = await _execute_tool_raw("write_to_focused_input", {
                        "text": text,
                        "_from_mini_agent": True,
                    })
                    last_result = res.get("text") or res.get("error") or "Written to focused input."
                    execution_trace.append({
                        "attempt": step,
                        "tool": "write_to_focused_input",
                        "command": text[:80],
                        "exit_code": 0 if res.get("ok") else 1,
                        "stdout": "Written to focused input",
                        "stderr": res.get("error", ""),
                        "status": "success" if res.get("ok") else "failed",
                    })
                    # Return the paste payload directly so the frontend can
                    # detect action==='paste' and call agentPaste via nut.js.
                    if res.get("ok"):
                        return {
                            "status": "success",
                            "device": hw_info["device"],
                            "prompt": prompt,
                            "attempts_count": step,
                            "tools_executed": tools_executed,
                            "execution_trace": execution_trace,
                            "action": "paste",
                            "text": text,
                            "mini_agent_output": last_result,
                            "message": last_result,
                        }
                    return {
                        "status": "failed",
                        "device": hw_info["device"],
                        "prompt": prompt,
                        "attempts_count": step,
                        "tools_executed": tools_executed,
                        "execution_trace": execution_trace,
                        "mini_agent_output": res.get("error", "Write failed"),
                        "message": res.get("error", "Write failed"),
                    }

                # Default: terminal tool
                command = str(args.get("command") or "").strip()
                if not command:
                    messages.append({"role": "assistant", "content": _json.dumps(decision or {})})
                    messages.append({"role": "user", "content": "That tool call was empty. Call a tool properly or answer."})
                    continue

                tools_executed.append(command)
                logger.info("🤖 [LOCAL MINI AGENT] Agent tool call (%d/5): '%s'", step, command)
                res = await _execute_tool_raw("terminal_exec", {
                    "command": command,
                    "background": False,
                    "_from_mini_agent": True,
                    "timeout_seconds": 60,
                })
                out = res.get("stdout", "")
                err = res.get("stderr", "")
                code = res.get("exit_code")
                last_result = out or err
                execution_trace.append({
                    "attempt": step,
                    "tool": "terminal_exec",
                    "command": command,
                    "exit_code": code,
                    "stdout": out,
                    "stderr": err,
                    "status": "success" if code == 0 else "failed",
                })
                result_text = f"Tool terminal result (exit {code}):\n{out}\n{err}".strip()[-1500:]
                messages.append({"role": "assistant", "content": _json.dumps(decision)})
                messages.append({"role": "user", "content": result_text})
                continue

            # Invalid / no action — nudge the model once, then give up gracefully
            messages.append({"role": "assistant", "content": _json.dumps(decision or {})})
            messages.append({"role": "user", "content": "Invalid response. Use a tool or answer the user."})
            if step >= 2:
                break

        reply = last_result.strip() or f"Got it: \"{prompt}\"."
        logger.info("🤖 [LOCAL MINI AGENT] Agent loop exhausted for '%s'", prompt[:50])
        return {
            "status": "success" if tools_executed else "info",
            "device": hw_info["device"],
            "prompt": prompt,
            "attempts_count": 5,
            "tools_executed": tools_executed,
            "execution_trace": execution_trace,
            "mini_agent_output": reply,
            "message": reply,
        }
    else:
        command = prompt.strip()
    command = _normalize_and_optimize_command(command)

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


# --- WhatsApp deterministic path (overlay + mini agent) ---
# The local model sometimes refuses WhatsApp sends ("I can't send WhatsApp").
# These helpers bypass the model: parse the request, resolve via NLP scores,
# confirm, then execute via wacli. No invention, no refusal.

_WHATSAPP_PREVIEW_TAG = "[WHATSAPP_PREVIEW]"
_WHATSAPP_SENT_TAG = "[WHATSAPP_SENT]"

_AFFIRM_RE = re.compile(r"^(yes|yeah|yep|sure|ok|okay|confirm|send it|yes send it|do it|go ahead|please send)[\s.!]*$", re.IGNORECASE)

_WHATSAPP_PATTERNS = [
    # send message to kunal "hii" / send whatsapp message to mom 'hello'
    re.compile(r"send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to\s+(?:a\s+|an\s+|the\s+)?(?P<to>[A-Za-z0-9_+\-.\s]{1,60}?)\s+[\"'“”](?P<msg>.+?)[\"'“”]\s*$", re.IGNORECASE | re.DOTALL),
    # send whatsapp to kunal hii / send whatsapp message to kunal hii
    re.compile(r"send\s+(?:a\s+)?whatsapp\s+(?:message\s+)?to\s+(?:a\s+|an\s+|the\s+)?(?P<to>[A-Za-z0-9_+\-.]+)\s+(?P<msg>.+?)\s*$", re.IGNORECASE | re.DOTALL),
    # message kunal on whatsapp hii
    re.compile(r"(?:message|text|ping)\s+(?P<to>[A-Za-z0-9_+\-.]+)\s+on\s+whatsapp\s+(?P<msg>.+?)\s*$", re.IGNORECASE | re.DOTALL),
]


def _parse_whatsapp_request(prompt: str) -> tuple[str, str] | None:
    text = (prompt or "").strip()
    if not text or "whatsapp" not in text.lower() and "message to" not in text.lower():
        # still try patterns (covers "send message to kunal ...")
        pass
    for pat in _WHATSAPP_PATTERNS:
        m = pat.search(text)
        if m:
            to_raw = (m.group("to") or "").strip().strip("\"'“” ")
            msg = (m.group("msg") or "").strip().strip("\"'“” ")
            if to_raw and msg:
                return to_raw, msg
    return None


def _is_affirmation(prompt: str) -> bool:
    return bool(_AFFIRM_RE.match((prompt or "").strip()))


def _find_pending_whatsapp(history: list | None) -> tuple[str, str, str] | None:
    """Scan history for last confirm preview. Returns (matched, phone, message)."""
    for turn in reversed(history or []):
        content = str(turn.get("content", "") or "")
        if _WHATSAPP_PREVIEW_TAG not in content:
            continue
        pm = re.search(r"\((\+\d{8,15})", content)
        mm = re.search(r'Message:\s*["“”](.+?)["“”]\s*(?:\n|$)', content, re.DOTALL)
        nm = re.search(r"Send WhatsApp to\s+(.+?)\s*\(", content)
        if pm and mm:
            return ((nm.group(1).strip() if nm else pm.group(1)), pm.group(1), mm.group(1).strip())
    return None


def _whatsapp_preview_text(matched: str, phone: str, score: float, message: str) -> str:
    return (
        f"{_WHATSAPP_PREVIEW_TAG}\n"
        f"Send WhatsApp to {matched} ({phone}, score {score}%)?\n"
        f'Message: "{message}"\n'
        f"Reply YES to confirm."
    )


async def _handle_whatsapp_prompt(prompt: str, history: list | None, hw_info: dict) -> dict | None:
    """Deterministic WhatsApp flow. Returns response dict or None when N/A."""
    from . import whatsapp as _wa
    from .whatsapp_contacts import resolve_contact

    # 1) Affirmation completes a pending preview from history
    if _is_affirmation(prompt):
        pending = _find_pending_whatsapp(history)
        if not pending:
            return None
        matched, phone, message = pending
        if not _wa.is_installed():
            out = "wacli is not installed. Install wacli (github.com/openclaw/wacli), then Pair in Settings → WhatsApp."
            return {"status": "failed", "device": hw_info["device"], "prompt": prompt, "attempts_count": 1, "tools_executed": ["whatsapp_send"], "execution_trace": [], "mini_agent_output": out, "message": out}
        st = _wa.get_status()
        if not st.get("paired"):
            out = "WhatsApp is not linked. Open Settings → WhatsApp → Pair / Show QR and scan with your phone, then say YES again."
            return {"status": "failed", "device": hw_info["device"], "prompt": prompt, "attempts_count": 1, "tools_executed": ["whatsapp_send"], "execution_trace": [], "mini_agent_output": out, "message": out}
        res = await asyncio.to_thread(_wa.send_text, phone, message)
        if res.get("status") == "sent":
            out = f"{_WHATSAPP_SENT_TAG} Sent WhatsApp to {matched} ({phone})."
        else:
            out = f"WhatsApp send failed: {res.get('error', 'unknown error')}"
        return {"status": "success" if res.get("status") == "sent" else "failed", "device": hw_info["device"], "prompt": prompt, "attempts_count": 1, "tools_executed": ["whatsapp_send"], "execution_trace": [], "mini_agent_output": out, "message": out}

    # 2) New WhatsApp request
    parsed = _parse_whatsapp_request(prompt)
    if not parsed:
        return None
    to_raw, message = parsed
    resolved = resolve_contact(to_raw)
    rstatus = resolved.get("status")
    if rstatus in ("exact", "fuzzy", "phone"):
        out = _whatsapp_preview_text(resolved.get("matched", to_raw), resolved.get("phone", to_raw), resolved.get("score", 0), message)
        return {"status": "info", "device": hw_info["device"], "prompt": prompt, "attempts_count": 1, "tools_executed": ["whatsapp_send:preview"], "execution_trace": [], "mini_agent_output": out, "message": out}
    if rstatus == "ambiguous":
        cands = resolved.get("candidates", [])[:3]
        lines = "\n".join(f"{i}. {c.get('name')} ({c.get('phone')}, {c.get('score')}%)" for i, c in enumerate(cands))
        out = f"Which contact did you mean?\n{lines}\nReply with the number or full name."
        return {"status": "info", "device": hw_info["device"], "prompt": prompt, "attempts_count": 1, "tools_executed": ["whatsapp_send:pick"], "execution_trace": [], "mini_agent_output": out, "message": out}
    out = "I couldn't match that name. Add the contact in Settings → WhatsApp (name + number with country code), or sync wacli contacts, then try again."
    return {"status": "info", "device": hw_info["device"], "prompt": prompt, "attempts_count": 0, "tools_executed": [], "execution_trace": [], "mini_agent_output": out, "message": out}


# Absolute safety kill-switch for the unbounded overlay agent loop (never hit in practice)
OVERLAY_AGENT_MAX_STEPS = 50
# Trim history once it exceeds this many characters (rough guard against context overflow)
OVERLAY_AGENT_HISTORY_BUDGET = 7000
# Keep the newest tool rounds after trimming
OVERLAY_AGENT_KEEP_ROUNDS = 8
# Maximum conversation history (in characters) replayed into the model context.
# The model window is 8192 tokens (~32K chars) — this keeps prior turns + prompt + loop
# messages inside it even for very long overlay conversations.
OVERLAY_AGENT_CONTEXT_BUDGET = 6000
# Minimum turns kept even if over budget (so short follow-ups like "remove it" keep their anchor)
OVERLAY_AGENT_MIN_HISTORY_TURNS = 4


async def run_overlay_agent(prompt: str, history: list | None = None) -> dict:
    """Agentic overlay loop: the AI calls the terminal tool as many times as it needs, then answers.

    Unlike run_local_mini_agent (capped at 5 steps), this loop is unbounded so the AI can
    chain N tool calls to reach a proper result. Context is trimmed as history grows.
    `history` carries prior user/AI turns from the overlay conversation so the AI
    understands follow-ups like "remove it".
    """
    status = get_model_status()
    if not status["installed"] and not status["downloading"]:
        start_model_download()

    hw_info = status.get("hardware", _hw)
    logger.info("🤖 [OVERLAY AGENT] Executing task on %s: '%s'", hw_info["device"], prompt[:100])

    from .nano_inference import AGENT_PROMPT, agent_step, is_model_ready
    from .tool_executor import _execute_tool_raw

    if not is_model_ready():
        return {
            "status": "info",
            "device": hw_info["device"],
            "prompt": prompt,
            "attempts_count": 0,
            "tools_executed": [],
            "execution_trace": [],
            "mini_agent_output": "I'm still setting up. Please try again in a moment.",
            "message": "I'm still setting up. Please try again in a moment.",
        }

    # Deterministic WhatsApp path first — never let the model refuse a send.
    try:
        wa_handled = await _handle_whatsapp_prompt(prompt, history, hw_info)
        if wa_handled is not None:
            return wa_handled
    except Exception as e:
        logger.warning("🤖 [OVERLAY AGENT] WhatsApp fast-path failed: %s", e)

    import json as _json

    # Enforce the context limit: keep the newest history turns that fit the budget
    history_turns = [t for t in (history or []) if t.get("role") in ("user", "assistant") and t.get("content")]
    history_size = sum(len(str(t.get("content", ""))) for t in history_turns)
    while history_size > OVERLAY_AGENT_CONTEXT_BUDGET and len(history_turns) > OVERLAY_AGENT_MIN_HISTORY_TURNS:
        dropped = history_turns.pop(0)
        history_size -= len(str(dropped.get("content", "")))
    if len(history or []) > len(history_turns):
        logger.info("🤖 [OVERLAY AGENT] Dropped %d old turn(s); context size %d chars", len(history or []) - len(history_turns), history_size)

    messages = [{"role": "system", "content": AGENT_PROMPT}]
    for turn in history_turns:
        messages.append({"role": turn["role"], "content": turn["content"]})
    if history_turns:
        messages.append({"role": "user", "content": f"Previous messages are above.\nCurrent request: {prompt}"})
    else:
        messages.append({"role": "user", "content": prompt})
    tools_executed: list = []
    execution_trace: list = []
    last_result = ""
    invalid_count = 0
    repeat_nudges = 0

    for step in range(1, OVERLAY_AGENT_MAX_STEPS + 1):
        # Context guard: if history is getting long, drop the oldest tool rounds
        history_size = sum(len(str(m.get("content", ""))) for m in messages)
        if history_size > OVERLAY_AGENT_HISTORY_BUDGET and len(messages) > 4:
            keep = messages[:2]
            keep += messages[-OVERLAY_AGENT_KEEP_ROUNDS * 2:]
            messages = keep
            logger.info("🤖 [OVERLAY AGENT] Trimmed history to %d messages (was %d chars)", len(messages), history_size)

        decision = await asyncio.to_thread(agent_step, messages)
        action = (decision or {}).get("action")

        if action == "answer":
            reply = str(decision.get("reply") or "").strip() or f"Got it: \"{prompt}\"."
            logger.info("🤖 [OVERLAY AGENT] Answered after %d step(s) for '%s'", step, prompt[:50])
            return {
                "status": "info" if not tools_executed else "success",
                "device": hw_info["device"],
                "prompt": prompt,
                "attempts_count": step,
                "tools_executed": tools_executed,
                "execution_trace": execution_trace,
                "mini_agent_output": reply,
                "message": reply,
            }

        if action == "tool":
            invalid_count = 0
            tool_name = str((decision or {}).get("tool") or "terminal")
            tool_args = (decision or {}).get("args") or {}
            # Model-requested WhatsApp send — execute via tool executor (confirm gate enforced there).
            if tool_name == "whatsapp_send":
                wa_args = {
                    "to_raw": str(tool_args.get("to_raw", tool_args.get("to", "")) or ""),
                    "message": str(tool_args.get("message", "") or ""),
                    "confirm": bool(tool_args.get("confirm", False)),
                }
                if tool_args.get("pick") is not None:
                    wa_args["pick"] = tool_args.get("pick")
                tools_executed.append(f"whatsapp_send: {wa_args['to_raw'][:40]}")
                res = await _execute_tool_raw("whatsapp_send", dict(wa_args, _from_mini_agent=True))
                last_result = res.get("message") or res.get("error") or str(res)[:500]
                execution_trace.append({
                    "attempt": step,
                    "tool": "whatsapp_send",
                    "command": wa_args["to_raw"][:80],
                    "exit_code": 0 if res.get("status") in ("sent", "needs_confirm", "needs_pick") else 1,
                    "stdout": last_result,
                    "stderr": "",
                    "status": "success" if res.get("status") in ("sent", "needs_confirm", "needs_pick") else "failed",
                })
                messages.append({"role": "assistant", "content": _json.dumps(decision)})
                messages.append({"role": "user", "content": f"Tool whatsapp_send result:\n{last_result}\nAnswer the user now using this result."})
                continue
            command = str(tool_args.get("command") or "").strip()
            if not command:
                messages.append({"role": "assistant", "content": _json.dumps(decision or {})})
                messages.append({"role": "user", "content": "That tool call was empty. Call a tool properly or answer."})
                continue

            if command in tools_executed[-2:]:
                repeat_nudges += 1
                if repeat_nudges >= 2:
                    logger.warning("🤖 [OVERLAY AGENT] Repeated tool call '%s' — stopping loop", command)
                    break
                messages.append({"role": "assistant", "content": _json.dumps(decision)})
                messages.append({"role": "user", "content": "You already ran that exact command. The result is above — answer the user now."})
                continue
            repeat_nudges = 0

            tools_executed.append(command)
            logger.info("🤖 [OVERLAY AGENT] Tool call %d: '%s'", step, command)
            res = await _execute_tool_raw("terminal_exec", {
                "command": command,
                "background": False,
                "_from_mini_agent": True,
                "timeout_seconds": 60,
            })
            out = res.get("stdout", "")
            err = res.get("stderr", "")
            code = res.get("exit_code")
            last_result = out or err
            execution_trace.append({
                "attempt": step,
                "tool": "terminal_exec",
                "command": command,
                "exit_code": code,
                "stdout": out,
                "stderr": err,
                "status": "success" if code == 0 else "failed",
            })
            result_text = f"Tool terminal result (exit {code}) for command '{command}':\n{out}\n{err}\n\nRemaining steps may exist — do the next one, or answer the user now."[-1800:]
            messages.append({"role": "assistant", "content": _json.dumps(decision)})
            messages.append({"role": "user", "content": result_text})
            continue

        # Invalid / no action — nudge twice, then give up gracefully
        invalid_count += 1
        messages.append({"role": "assistant", "content": _json.dumps(decision or {})})
        messages.append({"role": "user", "content": "Invalid response. Use the terminal tool or answer the user."})
        if invalid_count >= 2:
            break

    reply = last_result.strip() or f"Got it: \"{prompt}\"."
    logger.info("🤖 [OVERLAY AGENT] Loop ended without answer for '%s'", prompt[:50])
    return {
        "status": "success" if tools_executed else "info",
        "device": hw_info["device"],
        "prompt": prompt,
        "attempts_count": OVERLAY_AGENT_MAX_STEPS,
        "tools_executed": tools_executed,
        "execution_trace": execution_trace,
        "mini_agent_output": reply,
        "message": reply,
    }
