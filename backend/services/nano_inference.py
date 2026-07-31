"""Woxus — SmolLM3 3B local inference via llama.cpp.

Loads the downloaded GGUF weights and runs chat completions entirely on-device.
Supports both casual conversation and structured tool-call output.
"""

import json
import logging
import os
import re
import threading
from typing import Optional

logger = logging.getLogger(__name__)

from .local_model import _model_file_for, detect_hardware, MODEL_DIR

SYSTEM_PROMPT = (
    "You are Woxus, a smart and helpful desktop AI assistant. "
    "Keep responses concise and friendly. Answer in the user's language."
)

AGENT_PROMPT = (
    "/no_think\n"
    "You are Woxus, a smart desktop AI assistant running on the user's computer. "
    "You can use tools to complete tasks, then answer using the tool results.\n"
    "Tools:\n"
    '- terminal: run a shell command. args: {"command": "<command>"}\n'
    "Respond with ONLY a JSON object — no extra text, no markdown:\n"
    '- To use a tool: {"action": "tool", "tool": "terminal", "args": {"command": "<command>"}}\n'
    '- To answer the user: {"action": "answer", "reply": "<concise friendly reply>"}\n'
    "Rules:\n"
    "- If the user says it, that, this, them, the folder, the file — act on the item most recently "
    "mentioned in the conversation, never a made-up name.\n"
    "- If the user mentions the desktop (or home folder), run commands against the literal path "
    "~/Desktop — never the current working directory.\n"
    "- Use the EXACT file and folder names the user wrote. Never output placeholders like <name> "
    "or substitute a different name.\n"
    "- Use tools when you need real information from the computer (files, folders, system). "
    "Never invent file names or paths — check with a tool first.\n"
    "- You CAN see everything on the computer through tools. Never refuse a request about the computer — check with a tool instead.\n"
    "- If the user asks whether something exists or what is on the computer, ALWAYS check with a tool.\n"
    "- After a tool result, you may call another tool or give the final answer.\n"
    "- If the user asks for multiple steps, do them ONE AT A TIME — one tool call per step, "
    "wait for each result, then continue. Never claim an action happened unless a tool confirmed it.\n"
    "- If a tool failed, fix the command or answer honestly.\n"
    "Examples:\n"
    'User: list folders on my desktop\n'
    'AI: {"action": "tool", "tool": "terminal", "args": {"command": "ls -d ~/Desktop/*/ 2>/dev/null || ls -la ~/Desktop"}}\n'
    'Tool terminal result (exit 0) for command "ls -d ~/Desktop/*/ 2>/dev/null || ls -la ~/Desktop":\n/Users/me/Desktop/folder-a/\n'
    'AI: {"action": "answer", "reply": "Here are the folders on your desktop: folder-a."}\n'
    'User: hello\n'
    'AI: {"action": "answer", "reply": "Hello! How can I help you?"}\n'
)

MIN_VALID_SIZE = 10 * 1024 * 1024

_llm = None
_lock = threading.Lock()


def is_model_ready() -> bool:
    """Return True if the NanoAgent weights are downloaded and loadable."""
    model_path = _model_file_for(detect_hardware())
    return os.path.exists(model_path) and os.path.getsize(model_path) > MIN_VALID_SIZE


def _load_model():
    """Lazily load the GGUF model via llama.cpp (thread-safe)."""
    global _llm
    if _llm is not None:
        return _llm
    with _lock:
        if _llm is not None:
            return _llm

        model_path = _model_file_for(detect_hardware())
        if not os.path.exists(model_path) or os.path.getsize(model_path) <= MIN_VALID_SIZE:
            logger.warning("🤖 [NANOAGENT] Model file not found at %s", model_path)
            return None

        try:
            from llama_cpp import Llama
            _llm = Llama(
                model_path=model_path,
                n_ctx=8192,
                n_threads=4,
                n_gpu_layers=-1,
                chat_format="chatml",
                verbose=False,
            )
            logger.info("🤖 [NANOAGENT] Model loaded from %s", model_path)
        except Exception as e:
            logger.error("🤖 [NANOAGENT] Failed to load model: %s", e)
            return None
        return _llm


def _extract_json(text: str) -> Optional[dict]:
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


def agent_step(messages: list, max_tokens: int = 400) -> Optional[dict]:
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


def chat(user_text: str, system: str = SYSTEM_PROMPT, max_tokens: int = 256, temperature: float = 0.7) -> Optional[str]:
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
