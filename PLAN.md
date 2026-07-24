# Woxus — Build Plan

A production-quality Windows desktop AI companion application. Single identity: **Woxus** (male AI companion). No M4, no MYRAA — everything is Woxus.

---

## High-Level Architecture

```
woxus/
├── frontend/          # React + TypeScript (Tauri webview)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   ├── Sidebar/
│   │   │   ├── Settings/
│   │   │   ├── MemoryPanel/
│   │   │   ├── EmotionDashboard/
│   │   │   ├── VoiceOrb/
│   │   │   └── ApiKeys/
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   └── MemoryPage.tsx
│   │   ├── hooks/
│   │   │   ├── useAgent.ts
│   │   │   ├── useVoice.ts
│   │   │   └── useMemory.ts
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   ├── websocket.ts
│   │   │   └── voice.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── styles/
│   │       └── theme.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── backend/           # Python + FastAPI
│   ├── main.py
│   ├── requirements.txt
│   ├── config.py
│   ├── routes/
│   │   ├── chat.py
│   │   ├── voice.py          # Gemini Live WebSocket relay
│   │   ├── memory.py
│   │   ├── settings.py
│   │   └── system.py
│   ├── services/
│   │   ├── gemini_live.py    # Gemini Live API WebSocket handler (STT+TTS+streaming)
│   │   ├── memory_engine.py
│   │   └── proactive.py
│   ├── models/
│   │   └── schemas.py
│   └── middleware/
│       └── auth.py
├── agent/             # Python desktop automation agent
│   ├── main.py
│   ├── desktop_controller.py
│   ├── browser_controller.py
│   ├── clipboard_manager.py
│   ├── screenshot_tool.py
│   ├── keyboard_mouse.py
│   ├── wake_word.py
│   ├── activity_monitor.py
│   └── safety.py
├── memory/            # Local persistent memory engine
│   ├── database.py
│   ├── schema.sql
│   ├── extractor.py
│   ├── retriever.py
│   ├── ranker.py
│   ├── updater.py
│   ├── forgetter.py
│   └── summarizer.py
├── assets/
│   ├── icons/
│   ├── sounds/
│   └── images/
├── installer/
│   ├── build.bat
│   ├── build.ps1
│   ├── nsi/
│   └── config.json
├── build/
├── logs/
├── .env.example
├── .gitignore
└── README.md
```

---

## Phase 1 — Project Scaffolding (Week 1)

**Goal:** Clean project structure, initialized repos, basic shell of every module.

### File Structure
Create the full directory tree above with placeholder files in every directory.

### Dependencies to Install

| Layer | Packages |
|-------|----------|
| Frontend | `react`, `typescript`, `vite`, `tailwindcss`, `@tauri-apps/api`, `zustand`, `react-router-dom`, `framer-motion` |
| Backend | `fastapi`, `uvicorn`, `google-generativeai`, `pydantic`, `sqlalchemy`, `httpx`, `websockets`, `python-dotenv` |
| Agent | `pyautogui`, `pynput`, `psutil`, `pywin32`, `comtypes`, `speechrecognition`, `pyttsx3` |
| Memory | `chromadb` or `sqlite-utils`, `sentence-transformers` (local embeddings) |

### Deliverables
- [ ] All directories created
- [ ] `package.json` (frontend) with scripts: `dev`, `build`, `tauri`
- [ ] `requirements.txt` (backend)
- [ ] `requirements.txt` (agent)
- [ ] `.env.example` with all API key placeholders
- [ ] `.gitignore` (exclude `node_modules`, `__pycache__`, `.env`, `logs/`, `build/`)
- [ ] `README.md` with project overview
- [ ] Git repo initialized

---

## Phase 2 — Backend Core (Weeks 2–3)

**Goal:** Working FastAPI server with all API routes, Gemini integration, and streaming.

### Key Files

| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI app startup, shutdown, config loading, CORS, middleware |
| `backend/config.py` | Load from `.env`, validate keys, hot-reload |
| `backend/services/gemini.py` | Streaming chat, function calling, tool use, memory injection into context |
| `backend/routes/chat.py` | Send message, stream response, stop generation, regenerate, edit/delete message |
| `backend/routes/memory.py` | CRUD, search, export/import |
| `backend/routes/settings.py` | API key management (encrypt at rest using `cryptography`), provider switching |
| `backend/routes/system.py` | Health check, status, shutdown |
| `backend/routes/system.py` | Health check, status, shutdown |
| `backend/models/schemas.py` | Pydantic request/response models |
| `backend/middleware/auth.py` | API key validation middleware |

### API Key Management Pattern
```python
# config.py — never hardcode, always load from encrypted store
API_KEYS = {
    "gemini": load_encrypted("GEMINI_KEY"),
    "elevenlabs": load_encrypted("ELEVENLABS_KEY"),
    "cartesia": load_encrypted("CARTESIA_KEY"),
}
```

### WebSocket
Bidirectional communication between frontend and backend for streaming, voice events, status updates.

### Logging
Structured JSON logs to `logs/` directory, rotation, levels.

### Deliverables
- [ ] FastAPI server starts and serves all routes
- [ ] Gemini streaming chat works end-to-end
- [ ] WebSocket connection established from frontend
- [ ] API keys stored encrypted, loaded from `.env`
- [ ] Health endpoint returns 200
- [ ] Structured logging to `logs/`

---

## Phase 3 — Memory Engine (Weeks 3–4)

**Goal:** Production-grade persistent memory with extraction, retrieval, ranking, and forgetting.

### Memory Pipeline (before every Gemini request)
1. Analyze current user message
2. Search memory DB for relevant entries
3. Retrieve top-K memories ranked by relevance
4. Inject into Gemini context as system message
5. Generate response
6. Extract new memories from response
7. Update memory DB (save/update/ignore/forget)

### Database Schema (`memory/schema.sql`)
```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,        -- identity, preference, goal, project, relationship, emotional, behavioral
    content TEXT NOT NULL,
    metadata JSONB,                 -- source_conversation_id, timestamp, confidence, last_accessed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    importance REAL DEFAULT 0.5,    -- 0.0 to 1.0
    active BOOLEAN DEFAULT 1
);

CREATE TABLE memory_embeddings (
    memory_id TEXT PRIMARY KEY REFERENCES memories(id),
    embedding BLOB NOT NULL
);

CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pinned BOOLEAN DEFAULT 0
);

CREATE TABLE conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id),
    role TEXT NOT NULL,             -- user, assistant, system
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Memory Types

| Type | What It Stores | Examples |
|------|---------------|----------|
| Identity | Who the user is | Name, nickname, birthday, country, language, profession |
| Preference | What the user likes/dislikes | Favorite color, game, food, music, creators |
| Goal | What the user wants to achieve | Build a startup, lose weight, grow a YouTube channel |
| Project | Ongoing projects | Woxus, YouTube channels, websites, businesses |
| Relationship | People mentioned by user | Friends, family, partners, team members |
| Emotional | Emotionally important events | Achievements, failures, exciting moments |
| Behavioral | Learned patterns | Prefers short answers, likes technical explanations, casual language |

### Memory Extraction Logic
- **Save:** User states facts about themselves
- **Update:** User corrects or changes a previously stored fact
- **Ignore:** Greetings, small talk, filler words ("lol", "ok", "thanks")
- **Forget:** Explicit user requests, outdated info, low-confidence/old entries

### Retrieval
Sentence-transformer embeddings for semantic search, cosine similarity ranking, hybrid with keyword matching for exact facts.

### Deliverables
- [ ] SQLite database created with full schema
- [ ] Memory extractor class (save/update/ignore/forget)
- [ ] Memory retriever class (semantic search + keyword)
- [ ] Memory ranker (relevance scoring)
- [ ] Memory updater (merge changed facts)
- [ ] Memory forgetter (remove outdated/low-importance)
- [ ] Memory summarizer (periodic summaries)
- [ ] Integration into Gemini request pipeline (inject memories before every call)

---

## Phase 4 — Desktop Automation Agent (Weeks 4–5)

**Goal:** Fully functional background agent that controls the desktop.

### Agent Responsibilities
- Run as invisible background process (no console window — use `pythonw.exe` on Windows or `subprocess` with `CREATE_NO_WINDOW` flag)
- Listen for commands from backend via local HTTP/WebSocket
- Execute desktop actions using Windows APIs

### Desktop Controller (`agent/desktop_controller.py`)

```python
class DesktopController:
    def open_application(self, name: str) -> bool
    def close_application(self, name: str) -> bool
    def launch_url(self, url: str) -> bool
    def search_google(self, query: str) -> bool
    def search_youtube(self, query: str) -> bool
    def play_youtube_video(self, video_id: str) -> bool
    def control_media(self, action: str) -> bool      # play, pause, skip, volume
    def set_volume(self, level: int) -> bool
    def set_brightness(self, level: int) -> bool
    def take_screenshot(self) -> str                   # returns file path
    def read_clipboard(self) -> str
    def write_clipboard(self, text: str) -> bool
    def type_text(self, text: str) -> bool
    def press_keys(self, keys: list) -> bool
    def move_mouse(self, x: int, y: int) -> bool
    def click_mouse(self, button: str = "left") -> bool
    def scroll(self, direction: str) -> bool
    def lock_pc(self) -> bool
    def sleep_pc(self) -> bool
    def restart_pc(self) -> bool
    def shutdown_pc(self) -> bool
```

### Safety Layer (`agent/safety.py`)
- Require confirmation for: file deletion, drive formatting, system shutdown, restart, sleep, financial actions
- Return exact error reasons when automation fails
- Log every action with timestamp and result

### Wake Word & Voice Activity Detection (`agent/wake_word.py`)
- Use `speechrecognition` library with `pyaudio` for always-on listening
- Wake word detection: "Hey Woxus", "Woxus"
- Voice activity detection (VAD) to detect when user starts/stops speaking
- Interrupt support — stop TTS immediately when user speaks

### Activity Monitor (`agent/activity_monitor.py`)
- Track: active window title, keyboard idle time, mouse idle time, running processes
- Feed to proactive engine for conversation initiation

### Deliverables
- [ ] Agent runs invisibly (no console window)
- [ ] All desktop control methods implemented and tested
- [ ] Wake word detection working
- [ ] Voice activity detection working
- [ ] Interrupt support working
- [ ] Activity monitor tracking active window, keyboard/mouse idle time
- [ ] Safety confirmations for dangerous actions
- [ ] Every action logged with timestamp and result

---

## Phase 5 — Frontend (Weeks 5–7)

**Goal:** Premium glassmorphism UI matching the Woxus AURORA ROSE theme.

### Design System

| Token | Value |
|-------|-------|
| Primary | `#9D7BFF` (Soft Violet) |
| Secondary | `#E7B7A5` (Rose Gold) |
| Accent | `#C6A0FF` (Neon Lavender) |
| Background | Dark glassmorphism (`rgba(20, 20, 40, 0.85)` + blur) |
| Surface | Glass panels with backdrop blur |
| Text | White/light gray |
| Radius | 16px |
| Shadows | Soft, colored |

### Pages & Components

1. **Chat Page** — Chat bubbles, markdown rendering, code highlighting, copy buttons, streaming with typing animation, stop generation, regenerate/edit/delete, search chat, pinned chats
2. **Sidebar** — New Chat, History, Pinned, Settings, Memory, Tools, Models, Voice, Themes, About
3. **Settings Page** — Theme, accent color, voice provider, language, microphone/speaker selection, startup options, notifications, model selection, API keys (with validation), memory options, performance, developer mode, reset
4. **Memory Page** — List all memories, search, edit, delete, export/import, semantic search
5. **Voice Panel** — Push-to-talk toggle, always-listening toggle, wake word config, VAD sensitivity, STT/TTS provider selection, microphone/speaker selection, interrupt toggle
6. **Tools Panel** — Desktop control dashboard, browser control, system controls

### State Management
Zustand for global state, React Query for API calls.

### Key UX Details
- Voice orb animation (pulsing when listening, glowing when speaking)
- Animated waveform during TTS playback
- Smooth page transitions (framer-motion)
- 120 FPS animations where possible
- Responsive, keyboard-accessible
- Dark mode default, light mode toggle

### Deliverables
- [ ] React + TypeScript project initialized with Vite
- [ ] Tailwind CSS configured with Woxus theme
- [ ] Chat page fully functional (streaming, typing animation, stop, regenerate, edit, delete)
- [ ] Sidebar with all navigation items
- [ ] Settings page with all configuration options
- [ ] Memory panel with CRUD + search
- [ ] Voice panel with all controls
- [ ] Tools panel with desktop control dashboard
- [ ] Glassmorphism UI matching AURORA ROSE theme
- [ ] WebSocket integration for streaming and real-time events
- [ ] Dark mode + light mode toggle

---

## Phase 6 — Voice Integration (Weeks 7–8)

**Goal:** Full-duplex voice conversation — the core differentiator.

### Voice Pipeline
```
Microphone → STT (streaming) → Backend → Gemini (streaming) → TTS (streaming) → Speaker
```

### STT
- Google Speech-to-Text streaming API or Whisper.cpp for local fallback
- Real-time transcription with interim results

### TTS
- Primary: ElevenLabs (emotional, expressive voices)
- Secondary: Cartesia (fast, low-latency)
- Fallback: `pyttsx3` (local, free)

### Streaming TTS
Start playing audio as soon as first chunk arrives — don't wait for full response.

### Full-Duplex
- Always listening (no button press)
- Interrupt Woxus mid-speech → pause TTS → listen → respond
- Natural turn-taking with human-like pauses (100–300ms)
- Breathing effects and pacing variations

### Emotional Voice
ElevenLabs supports emotion labels — map Woxus's internal emotion state to voice parameters (warmth, speed, pitch, stability).

### Deliverables
- [ ] STT streaming pipeline working
- [ ] TTS streaming pipeline working (ElevenLabs → Cartesia → pyttsx3 fallback)
- [ ] Full-duplex: always-on listening, no push-to-talk
- [ ] Wake word: "Hey Woxus", "Woxus"
- [ ] Interrupt support: Woxus stops speaking when user starts talking
- [ ] Natural turn-taking with human-like pauses
- [ ] Emotional voice mapping (emotion state → voice parameters)

---

## Phase 7 — Proactive Engine (Week 8)

**Goal:** Woxus initiates conversations unprompted based on context.

### Evaluation Loop (every 10–30 seconds)
1. Check user activity (active app, keyboard/mouse idle time)
2. Check time of day
3. Check memory (relevant context)
4. Check emotional indicators (conversation tone, recent interactions)
5. Decide: respond / ask / encourage / observe / initiate / skip

### Initiation Examples
- User coding 3+ hours → "Want to take a break?"
- User opened analytics → "You've been checking analytics again."
- Morning → "Good morning. How'd you sleep?"
- User seems frustrated (typing fast, deleting) → "You seem stressed. Want to talk?"

### Deliverables
- [ ] Proactive evaluation loop implemented
- [ ] Activity monitoring feeds into decision engine
- [ ] Contextual conversation initiation working
- [ ] Initiations feel helpful, not annoying
- [ ] User can disable proactive behavior in settings

---

## Phase 8 — Windows Desktop Packaging (Weeks 9–10)

**Goal:** Single `Woxus.exe` that works on a clean Windows machine.

### Approach: Tauri + Python subprocess

Tauri bundles the React frontend into a native Windows shell. The Python backend runs as a managed subprocess spawned by Tauri's Rust backend.

### Startup Sequence
```
User double-clicks Woxus.exe
  → Tauri app launches (no terminal window)
  → Rust backend starts Python subprocess (pythonw.exe, hidden window)
  → Python backend starts FastAPI server on localhost:8000
  → Rust backend waits for health endpoint (GET /health)
  → Frontend connects to backend via WebSocket
  → Status shows "🟢 Woxus Online"
  → If backend crashes → auto-restart (max 3 retries)
  → If port occupied → detect existing instance, reconnect
```

### Packaging
- Use `PyInstaller` or `Nuitka` to bundle Python backend into a single directory
- Include Python runtime (embed `python311.dll` + stdlib)
- Bundle all dependencies (DLLs, .pyd files)
- Tauri bundles frontend as static assets
- NSIS or Inno Setup creates installer with:
  - Desktop shortcut
  - Start menu entry
  - Uninstaller
  - Taskbar icon
  - System tray icon
  - Auto-launch registry entry (optional)

### Windows-Specific Features
- App icon (.ico)
- Splash screen on launch
- System tray with context menu (Open, Settings, Quit)
- Remember window size and position
- Start minimized to tray option
- Close to tray (not exit)
- Single instance (mutex)
- Windows toast notifications
- Auto-update architecture (check GitHub releases)

### Deliverables
- [ ] Tauri app builds successfully
- [ ] Python backend bundled with PyInstaller
- [ ] Backend auto-starts when Woxus.exe launches
- [ ] Health check works, frontend connects automatically
- [ ] Status shows "🟢 Woxus Online" on clean launch
- [ ] Backend auto-restarts if it crashes (max 3 retries)
- [ ] Port conflict detection and reconnect
- [ ] Installer created with NSIS/Inno Setup
- [ ] Portable version created
- [ ] All Windows features working (tray, single instance, close-to-tray, etc.)

---

## Phase 9 — Polish & Production (Weeks 10–11)

**Goal:** Production-ready build with full test coverage.

### Quality Checklist
- [ ] No placeholder code, no TODO comments, no dummy UI
- [ ] Error handling on every API call — never silently fail
- [ ] Structured logging (JSON, rotate, levels)
- [ ] Input validation on all endpoints
- [ ] Encrypted local settings (AES-256 via `cryptography` library)
- [ ] Crash recovery — auto-restart backend if it crashes
- [ ] Performance: lazy loading, caching, multithreading, non-blocking UI
- [ ] Security: no hardcoded secrets, input sanitization, API key encryption
- [ ] Build script (`build.ps1`) that does everything in one command

### Build Script (`build.ps1`)
```
.\build.ps1
→ Install dependencies
→ Build frontend
→ Build backend (PyInstaller)
→ Bundle everything
→ Generate installer
→ Generate portable version
→ Output: Woxus.exe, Woxus Installer.exe, Portable.zip
```

### Verification Steps
1. Build `Woxus.exe`
2. Test on clean Windows VM (no Python installed)
3. Verify double-click launches, backend auto-starts, status shows "Woxus Online"
4. Test all desktop automation features (YouTube, browser, apps, files)
5. Test voice pipeline (STT → Gemini → TTS)
6. Test memory (add fact → restart → recall)
7. Test settings (API keys, theme, voice providers)
8. Test installer/uninstaller

### Deliverables
- [ ] Full production build passes all verification steps
- [ ] `Woxus.exe` launches on clean Windows machine without Python
- [ ] All desktop automation features work
- [ ] Voice pipeline works end-to-end
- [ ] Memory persists across restarts
- [ ] Installer/uninstaller work correctly
- [ ] Build script (`build.ps1`) produces all outputs in one command
- [ ] README with build instructions, release notes, license

---

## Milestone Summary

| Phase | Duration | Milestone |
|-------|----------|-----------|
| 1. Scaffolding | 1 week | Project structure, all files created, deps installed |
| 2. Backend Core | 2 weeks | FastAPI + Gemini + WebSocket + all API routes |
| 3. Memory Engine | 2 weeks | Persistent memory with extraction, retrieval, ranking |
| 4. Desktop Agent | 2 weeks | Full desktop automation, wake word, activity monitor |
| 5. Frontend | 3 weeks | Glassmorphism UI, chat, settings, memory panel |
| 6. Voice Integration | 2 weeks | Full-duplex voice, streaming STT/TTS, interrupt |
| 7. Proactive Engine | 1 week | Context-aware conversation initiation |
| 8. Packaging | 2 weeks | Tauri build, installer, standalone .exe |
| 9. Polish | 2 weeks | Testing, quality, build script, verification |

**Total estimated timeline: ~15 weeks (3.5 months)**

---

## Immediate Next Steps

1. Initialize git repo in `/Users/nishantpatel/Desktop/woxus-core`
2. Create the full directory structure above
3. Set up `.gitignore` (exclude `node_modules`, `__pycache__`, `.env`, `logs/`, `build/`)
4. Create `.env.example` with all required API key placeholders
5. Start with **Phase 1** — scaffolding the backend and frontend skeletons
