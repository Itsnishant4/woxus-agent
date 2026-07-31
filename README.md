# Woxus

A production-quality Windows desktop AI companion using **Google Gemini Live API** for voice, reasoning, and conversation — all through a single API.

- **Gemini Live API** — one WebSocket handles speech-to-text, text-to-speech, streaming reasoning, interruption, and affective dialog. No third-party voice APIs.
- **Memory system** — long-term retention of user context, preferences, projects, and goals using SQLite + embeddings.
- **Desktop automation** — open/close apps, manage files, control media, launch websites, keyboard/mouse control.
- **Proactive behavior** — context-aware conversation initiation based on activity, time of day, and memory.
- **Premium UI** — dark glassmorphism with AURORA ROSE palette (violet, rose-gold, neon lavender), built with React + Tailwind CSS.
- **Windows native** — packaged as a single `Woxus.exe` via Tauri + PyInstaller.

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, Tailwind CSS, Framer Motion, Zustand |
| Backend | Python 3.11+, FastAPI, google-genai SDK, websockets |
| AI & Voice | Google Gemini Live API (built-in STT/TTS, streaming, interruption) |
| Memory | SQLite + sentence-transformers embeddings (semantic search) |
| Desktop control | pyautogui, pynput, psutil, win32com |
| Packaging | Tauri (Rust), PyInstaller, NSIS |

---

## Quick start (development)

### Prerequisites
- Node.js 18+, npm, Python 3.11+, pip, Tauri CLI (`cargo install tauri-cli`)

### Setup
```bash
git clone https://github.com/your-username/woxus-core.git
cd woxus-core
cp .env.example .env  # fill in GEMINI_API_KEY
```

**Frontend:**
```bash
cd frontend && npm install && npm run dev
```

**Backend:**
```bash
cd backend && pip install -r requirements.txt
cd .. && uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:5173` and talk to Woxus.

---

## How voice works — single API pipeline

```
Microphone ──16kHz PCM──→ Gemini Live API WebSocket ──24kHz PCM──→ Speaker
                                │
                          Transcription text
                          (for memory, UI display)
```

Gemini Live API handles everything:
- **Speech-to-text** — built-in, returns transcript with timing
- **Text-to-speech** — prebuilt voices (Puck, etc.), no separate TTS key
- **Barge-in / interrupt** — speak while Woxus is talking, it stops and listens
- **Affective dialog** — emotional tone built into the model
- **Tool use** — call functions mid-conversation for desktop automation

---

## Key features

- **Voice interaction** — always-on microphone, wake word, interruption, streaming audio
- **Memory system** — auto-extract facts, semantic retrieval, update/forget
- **Desktop automation** — apps, browser, files, clipboard, system control with safety confirmations
- **Proactive engine** — initiates conversations based on activity and context
- **Dark glassmorphism UI** — animated voice orb, memory dashboard, settings

---

## Project plan

See [`PLAN.md`](PLAN.md) for the full 9-phase implementation plan.

**Phase 1** (current): Project scaffolding — done.
**Phase 2**: Backend core — FastAPI + Gemini Live API integration.
**Phase 3**: Memory engine.
**Phase 4**: Desktop automation agent.
**Phase 5**: Frontend UI.
**Phase 6**: Voice integration (Gemini Live API WebSocket).
**Phase 7**: Proactive engine.
**Phase 8**: Windows packaging.
**Phase 9**: Polish & production build.

---

## License

TBD
