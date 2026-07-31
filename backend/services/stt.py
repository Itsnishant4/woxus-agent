"""Woxus — local speech-to-text via faster-whisper.

Transcribes audio uploads (webm/wav/mp3) entirely on-device.
Model is downloaded automatically on first use (tiny, ~75MB).
"""

import logging
import os
import tempfile
import threading

logger = logging.getLogger(__name__)

STT_MODEL = os.getenv("WOXUS_STT_MODEL", "tiny")

_model = None
_lock = threading.Lock()


def is_model_ready() -> bool:
    """True if the whisper model is already loaded or cached on disk."""
    if _model is not None:
        return True
    if os.environ.get("HF_HOME"):
        cache_root = os.environ["HF_HOME"]
    else:
        cache_root = os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")
    model_id = f"Systran/faster-whisper-{STT_MODEL}"
    repo_dir = os.path.join(cache_root, "models--" + model_id.replace("/", "--"))
    return os.path.isdir(repo_dir) and bool(os.listdir(repo_dir))


def _get_model():
    """Lazily load the whisper model (thread-safe)."""
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
            logger.info("🎙️ [STT] Loading whisper model '%s'...", STT_MODEL)
            _model = WhisperModel(STT_MODEL, device="cpu", compute_type="int8")
            logger.info("🎙️ [STT] Whisper model '%s' ready.", STT_MODEL)
        except Exception as e:
            logger.error("🎙️ [STT] Failed to load model: %s", e)
            return None
        return _model


def transcribe_audio(data: bytes, filename: str = "audio.webm") -> str:
    """Transcribe raw audio bytes to text. Returns empty string on failure."""
    model = _get_model()
    if model is None:
        return ""

    suffix = os.path.splitext(filename)[1] or ".webm"
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            tmp_path = f.name

        segments, _info = model.transcribe(
            tmp_path,
            language=None,
            vad_filter=True,
            beam_size=5,
        )
        text = "".join(seg.text for seg in segments).strip()
        logger.info("🎙️ [STT] Transcribed: '%s'", text[:120])
        return text
    except Exception as e:
        logger.error("🎙️ [STT] Transcription failed: %s", e)
        return ""
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    """Wrap 16-bit little-endian mono PCM into a WAV container."""
    import struct

    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_size, b"WAVE", b"fmt ",
        16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
        b"data", data_size,
    )
    return header + pcm


def transcribe_pcm16(pcm: bytes, sample_rate: int = 16000) -> str:
    """Transcribe raw 16-bit PCM to text (used to log voice turns for
    session history replay). Returns empty string on silence/failure."""
    model = _get_model()
    if model is None or not pcm:
        return ""

    tmp_path = ""
    try:
        wav = _pcm_to_wav(pcm, sample_rate)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav)
            tmp_path = f.name

        segments, _info = model.transcribe(
            tmp_path,
            language=None,
            vad_filter=True,
            beam_size=5,
        )
        text = "".join(seg.text for seg in segments).strip()
        if text:
            logger.info("🎙️ [STT] PCM transcribed: '%s'", text[:120])
        return text
    except Exception as e:
        logger.error("🎙️ [STT] PCM transcription failed: %s", e)
        return ""
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
