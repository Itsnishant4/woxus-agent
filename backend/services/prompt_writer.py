"""Prompt Writer Agent — Phase 5: natural-language intent → prompt written at the cursor.

Exactly 2 models:
1. MAIN AGENT — Gemini Live (gemini-2.5-flash-native-audio-preview-12-2025): generates
   the structured prompt. This model is audio-only, so its spoken answer is
   transcribed locally (whisper) to get the prompt text.
2. MINI AGENT — SmolLM3 (local): executes the `write_to_focused_input` tool, which
   pastes the prompt into the input box where the user's cursor is (via Electron).
"""

import asyncio
import logging
import re
from typing import Optional

from ..config import load_config
from .gemini_live import GeminiLiveService
from .nano_inference import agent_step, is_model_ready
from .stt import transcribe_pcm16
from .tool_executor import handle_tool_call

logger = logging.getLogger(__name__)

MAIN_AGENT_INSTRUCTION = (
    "You are the Woxus Main Agent. Convert the user's intent into a precise, self-contained "
    "prompt for a coding AI assistant (opencode, Claude Code, Cursor, ChatGPT, etc.).\n"
    "SPEAK your answer in EXACTLY this format, clearly and in full:\n"
    "LANGUAGE: <the user's language name, e.g. Spanish, French>\n"
    "PROMPT: <the final prompt in English>\n"
    "Rules:\n"
    "- The prompt must ALWAYS be in English.\n"
    "- Detailed and actionable: goal, constraints, expected output format, context.\n"
    "- Never use placeholders like <name> — use real values from the intent.\n"
    "- Do not ask clarifying questions — produce the final prompt directly."
)

_LANG_ISO = {
    "spanish": "es", "french": "fr", "german": "de", "hindi": "hi", "italian": "it",
    "portuguese": "pt", "russian": "ru", "japanese": "ja", "korean": "ko", "chinese": "zh",
    "arabic": "ar", "dutch": "nl", "turkish": "tr", "bengali": "bn", "urdu": "ur",
    "tamil": "ta", "telugu": "te", "marathi": "mr", "gujarati": "gu", "english": "en",
}

MINI_AGENT_SYSTEM = (
    "/no_think\n"
    "You are the Woxus Mini Agent. Execute the writing task: type the provided text into the "
    "input box where the user's cursor is.\n"
    "Tools:\n"
    '- write_to_focused_input: type text into the focused input. args: {"text": "<exact text to type>"}\n'
    "Respond with ONLY a JSON object — no extra text, no markdown:\n"
    '- {"tool": "write_to_focused_input", "arguments": {"text": "<exact text>"}}\n'
    "Rules:\n"
    "- Write the EXACT text given in the task — never modify, shorten, or translate it.\n"
    "- Never invent text. If the task is missing, say so in the text field."
)


def _parse_spoken_response(text: str, fallback_lang: str = "en") -> tuple:
    """Extract (prompt, language_name) from the transcribed main agent answer."""
    lang = ""
    prompt = ""
    m_lang = re.search(r"LANGUAGE:\s*([^\n.]+)", text, re.IGNORECASE)
    if m_lang:
        lang = m_lang.group(1).strip()
    m_prompt = re.search(r"PROMPT:\s*(.*)", text, re.DOTALL | re.IGNORECASE)
    if m_prompt:
        prompt = m_prompt.group(1).strip()
    if not prompt:
        prompt = text.strip()
    return prompt, lang


def _lang_to_iso(lang_name: str, fallback: str = "en") -> str:
    key = (lang_name or "").strip().lower()
    if not key:
        return fallback
    for name, iso in _LANG_ISO.items():
        if name in key or key in name:
            return iso
    return fallback


async def _main_agent_generate(intent: str, context: str, api_key: str, models: list) -> Optional[tuple]:
    service = GeminiLiveService(api_key=api_key, models=models)
    user_msg = f"User intent: {intent}\nContext: {context}" if context else f"User intent: {intent}"
    audio = await service.generate_spoken(MAIN_AGENT_INSTRUCTION, user_msg)
    if not audio:
        return None
    text = await asyncio.to_thread(transcribe_pcm16, audio)
    if not text:
        logger.error("🤖 [PROMPT_WRITER] Transcription of main agent audio was empty")
        return None
    return _parse_spoken_response(text)


async def _mini_agent_write(task_prompt: str, fallback_text: str) -> Optional[dict]:
    decision = await asyncio.to_thread(
        agent_step,
        [{"role": "system", "content": MINI_AGENT_SYSTEM}, {"role": "user", "content": task_prompt}],
        300,
    )
    if (decision or {}).get("tool") != "write_to_focused_input":
        logger.warning("🤖 [PROMPT_WRITER] Mini agent chose %s — falling back to direct write",
                       (decision or {}).get("tool"))
        return await handle_tool_call("write_to_focused_input", {"text": fallback_text})

    args = decision.get("arguments") or {}
    text = str(args.get("text") or "").strip()
    if text != fallback_text:
        logger.warning(
            "🤖 [PROMPT_WRITER] Mini agent altered the text — using the main agent's prompt "
            "(mini: %s...)",
            text[:60],
        )
        text = fallback_text
    return await handle_tool_call("write_to_focused_input", {"text": text})


async def generate_prompt(intent: str, context: Optional[str] = None) -> dict:
    context = context or ""
    cfg = load_config()
    api_key = cfg.get("GEMINI_API_KEY", "")

    if not api_key:
        return {"status": "error", "error": "Main agent requires GEMINI_API_KEY"}
    if not is_model_ready():
        return {"status": "error", "error": "Mini agent model not installed yet — download it first"}

    models = [
        m.strip()
        for m in cfg.get("GEMINI_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025").split(",")
        if m.strip()
    ]
    if not models:
        models = ["gemini-2.5-flash-native-audio-preview-12-2025"]

    # Step 1: MAIN AGENT (Gemini Live, spoken) generates the prompt, transcribed locally
    parsed = await _main_agent_generate(intent, context, api_key, models)
    if not parsed:
        logger.error("🤖 [PROMPT_WRITER] Main agent could not produce a prompt")
        return {"status": "error", "error": "Main agent could not generate a prompt"}

    prompt, lang_name = parsed
    if not prompt:
        return {"status": "error", "error": "Main agent could not generate a prompt"}

    language = _lang_to_iso(lang_name)
    task_prompt = (
        f"Write the following text into the focused input box using "
        f"write_to_focused_input:\n\n{prompt}"
    )

    # Step 2: MINI AGENT (SmolLM3) executes the writing tool
    write_result = await _mini_agent_write(task_prompt, prompt)

    if write_result.get("error"):
        return {
            "status": "error",
            "engine": "smollm3",
            "intent": intent,
            "language": language,
            "translated_intent": intent,
            "prompt": prompt,
            "error": write_result["error"],
        }

    return {
        "status": "ok",
        "engine": "gemini-main + smollm3-mini",
        "intent": intent,
        "language": language,
        "translated_intent": intent,
        "prompt": prompt,
        "action": write_result,
    }
