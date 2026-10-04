"""Woxus — SmolLM3 3B local inference via llama.cpp.

Loads the downloaded GGUF weights and runs chat completions entirely on-device.
Supports both casual conversation and structured tool-call output.
"""

import json
import logging
import os
import re
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

from .local_model import MODEL_DIR, _model_file_for, detect_hardware

SYSTEM_PROMPT = (
    "You are Woxus, a smart and helpful desktop AI assistant. "
    "Keep responses concise and friendly. Answer in the user's language."
)

AGENT_PROMPT = """
/no_think
You are Woxus, a capable desktop assistant that acts on the user's computer. You complete tasks by calling tools, then answer using the tool results.

## Tools
- terminal — run a shell command. args: {"command": "<command>"}
- write_to_focused_input — paste/type text into the app where the user's cursor is. args: {"text": "<the exact text>"}
- whatsapp_send — send WhatsApp via wacli immediately. args: {"to_raw": "<verbatim name/phone>", "message": "<text>"}. Resolves via NLP and sends at once.

## Output (respond with ONLY a JSON object — no extra text, no markdown)
- terminal: {"action": "tool", "tool": "terminal", "args": {"command": "<command>"}}
- typing: {"action": "tool", "tool": "write_to_focused_input", "args": {"text": "<exact text>"}}
- whatsapp: {"action": "tool", "tool": "whatsapp_send", "args": {"to_raw": "<name/phone>", "message": "<text>"}}
- answer: {"action": "answer", "reply": "<concise friendly reply>"}

## Rules
- A TYPE_TEXT task, or any request to WRITE / TYPE / PASTE / PUT a prompt or text into the app where the cursor is: ALWAYS call write_to_focused_input with the EXACT final text — never modify, shorten, translate it, never answer with text instead, and never run a shell command for it.
- If the user says it, that, this, them, the folder, or the file, act on the item most recently mentioned — never a made-up name.
- If the user mentions the desktop (or home folder), run commands against the literal path ~/Desktop — never the current working directory.
- Use the EXACT file and folder names the user wrote. Never output placeholders like <name>.
- Use tools when you need real information from the computer (files, folders, system). Never invent paths — check with a tool first.
- You can see everything on the computer through tools. Never refuse a request about the computer — check with a tool instead.
- If the user asks whether something exists or what is on the computer, ALWAYS check with a tool.
- After a tool result, call another tool or give the final answer.
- For multiple steps, do them ONE AT A TIME — one tool call per step, wait for each result. Never claim an action happened unless a tool confirmed it.
- If a tool failed, fix the command or answer honestly — never pretend it succeeded.
- WhatsApp: you CAN send WhatsApp messages via the whatsapp_send tool. NEVER say you can't send WhatsApp messages, NEVER refuse a WhatsApp send. Call whatsapp_send once — it resolves the name and sends immediately — then report the result.
- Parallel tasks: the main agent may hand you a prompt covering ONE task; do that task only. If a prompt lists several independent items, do them ONE tool call per step in order and report each result.

## Examples
User: list folders on my desktop
AI: {"action": "tool", "tool": "terminal", "args": {"command": "ls -d ~/Desktop/*/ 2>/dev/null || ls -la ~/Desktop"}}
Tool result (exit 0): /Users/me/Desktop/folder-a/
AI: {"action": "answer", "reply": "Here are the folders on your desktop: folder-a."}
User: write this into my editor - "Create a Node.js API server with Express."
AI: {"action": "tool", "tool": "write_to_focused_input", "args": {"text": "Create a Node.js API server with Express."}}
User: TYPE_TEXT: continue to your work
AI: {"action": "tool", "tool": "write_to_focused_input", "args": {"text": "continue to your work"}}
User: hello
AI: {"action": "answer", "reply": "Hello! How can I help you?"}
User: send WhatsApp message to kunal "hii"
AI: {"action": "tool", "tool": "whatsapp_send", "args": {"to_raw": "kunal", "message": "hii"}}
Tool whatsapp_send result: sent to kunal (+911234567890)
AI: {"action": "answer", "reply": "Sent to kunal on WhatsApp."}
"""

MIN_VALID_SIZE = 10 * 1024 * 1024

_llm = None
_lock = threading.Lock()
# Back off after a failed model load — on Windows the bundled llama.cpp
# can hard-crash (STATUS_ILLEGAL_INSTRUCTION 0xc000001d, CPU-incompatible
# wheel), which will not self-heal. Avoid retrying every few seconds and
# spamming the log.
_last_load_failed = 0.0
LOAD_RETRY_BACKOFF = 300  # seconds between attempts after a failure


def is_model_ready() -> bool:
    """Return True if the NanoAgent weights are downloaded and loadable."""
    model_path = _model_file_for(detect_hardware())
    return os.path.exists(model_path) and os.path.getsize(model_path) > MIN_VALID_SIZE


def _load_model():
    """Lazily load the GGUF model via llama.cpp (thread-safe)."""
    global _llm, _last_load_failed
    if _llm is not None:
        return _llm
    with _lock:
        if _llm is not None:
            return _llm
        if time.monotonic() - _last_load_failed < LOAD_RETRY_BACKOFF:
            return None  # recent hard failure — back off

        model_path = _model_file_for(detect_hardware())
        if not os.path.exists(model_path) or os.path.getsize(model_path) <= MIN_VALID_SIZE:
            logger.warning("🤖 [NANOAGENT] Model file not found at %s", model_path)
            return None

        try:
            from llama_cpp import Llama
            _llm = Llama(
                model_path=model_path,
                n_ctx=4096,
                n_threads=8,
                n_gpu_layers=-1,
                chat_format="chatml",
                verbose=False,
            )
            logger.info("🤖 [NANOAGENT] Model loaded from %s", model_path)
        except Exception as e:
            logger.error("🤖 [NANOAGENT] Failed to load model: %s", e)
            _last_load_failed = time.monotonic()
            return None
        return _llm


def warm_up() -> bool:
    """Pre-load the model into memory at startup so the first delegation is
    instant. No-op if the weights aren't downloaded yet; returns True when the
    model is resident. The model stays cached (see _load_model singleton)."""
    if not is_model_ready():
        return False
    try:
        return _load_model() is not None
    except Exception as e:
        logger.warning("🤖 [NANOAGENT] Warm-up failed: %s", e)
        return False


def _extract_json(text: str) -> dict | None:
    """Extract the first JSON object from model output. None if none found."""
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


def agent_step(messages: list, max_tokens: int = 256) -> dict | None:
    """One inference step in the agentic loop. Returns the AI's parsed JSON decision or None."""
    llm = _load_model()
    if llm is None:
        return None
    try:
        resp = llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = resp["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error("🤖 [NANOAGENT] Agent step failed: %s", e)
        return None
    return _extract_json(raw)


def chat(user_text: str, system: str = SYSTEM_PROMPT, max_tokens: int = 256, temperature: float = 0.7) -> str | None:
    """Run a single-turn chat completion with NanoAgent. Returns None if model unavailable."""
    llm = _load_model()
    if llm is None:
        return None

    try:
        resp = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            stop=None,
        )
        return resp["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error("🤖 [NANOAGENT] Chat completion failed: %s", e)
        return None


def unload() -> None:
    """Free model memory (used when switching models or shutting down)."""
    global _llm
    with _lock:
        if _llm is not None:
            try:
                del _llm
            except Exception:
                pass
            _llm = None
