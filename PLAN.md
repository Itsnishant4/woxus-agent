# Woxus — Build Plan (v2)

Cross-platform desktop AI agent (Electron). White theme. Background-running.
Monetized via license keys with 10-min free trial + admin panel.

---

## High-Level Architecture

```
woxus/
├── desktop/                 # Electron app (Mac + Windows)
│   ├── src/
│   │   ├── main/            # Electron main process
│   │   │   ├── index.ts     # App entry, tray, background service
│   │   │   ├── tray.ts      # System tray (minimize-to-tray)
│   │   │   ├── ipc.ts       # IPC handlers between renderer & main
│   │   │   └── updater.ts   # Auto-update (electron-updater)
│   │   ├── renderer/        # React frontend
│   │   │   ├── components/
│   │   │   │   ├── ui/              # ShadCN primitives (button, input, dialog, etc.)
│   │   │   │   ├── Chat/
│   │   │   │   ├── Sidebar/
│   │   │   │   ├── NoteWriter/
│   │   │   │   ├── Terminal/
│   │   │   │   ├── License/
│   │   │   │   ├── Feedback/
│   │   │   │   ├── VoiceCommandBar/ # Voice input + command palette
│   │   │   │   ├── AgentStatus/     # Tray-connected status indicator
│   │   │   │   └── Settings/
│   │   │   ├── pages/
│   │   │   │   ├── ChatPage.tsx
│   │   │   │   ├── NotePage.tsx
│   │   │   │   ├── TerminalPage.tsx
│   │   │   │   ├── LicensePage.tsx
│   │   │   │   ├── FeedbackPage.tsx
│   │   │   │   ├── VoicePage.tsx
│   │   │   │   └── SettingsPage.tsx
│   │   │   ├── hooks/
│   │   │   ├── lib/                 # ShadCN utility (cn(), etc.)
│   │   │   ├── services/
│   │   │   ├── store/
│   │   │   └── styles/
│   │   │       └── globals.css      # Tailwind v4 + ShadCN theme vars (dark + light)
│   │   └── assets/
│   ├── electron-builder.yml
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/                 # Python + FastAPI (local service)
│   ├── main.py
│   ├── requirements.txt
│   ├── config.py
│   ├── routes/
│   │   ├── chat.py
│   │   ├── voice.py
│   │   ├── note.py          # File writing endpoint
│   │   ├── terminal.py      # Terminal execution endpoint
│   │   ├── license.py       # License verification endpoint
│   │   ├── feedback.py
│   │   ├── system.py
│   │   └── settings.py
│   ├── services/
│   │   ├── gemini_live.py
│   │   ├── terminal_exec.py # Secure terminal with retry
│   │   ├── file_writer.py   # .md, .txt, code file writer
│   │   ├── license.py       # Local license cache + validation
│   │   ├── prompt_writer.py # nut.js automation engine
│   │   └── trial_tracker.py # 10-min trial with device fingerprint
│   ├── models/
│   │   └── schemas.py
│   └── middleware/
│       ├── auth.py          # License check middleware
│       └── trial.py         # Trial session limiter
├── agent/                   # Python desktop automation
│   ├── main.py
│   ├── desktop_controller.py
│   ├── browser_controller.py
│   ├── nutjs_automation.py  # nut.js prompt writer
│   ├── keyboard_mouse.py
│   └── safety.py
├── admin/                   # Next.js admin panel (separate)
│   ├── src/
│   │   ├── app/
│   │   │   ├── login/
│   │   │   ├── dashboard/
│   │   │   ├── users/
│   │   │   ├── licenses/
│   │   │   ├── usage/
│   │   │   ├── feedback/
│   │   │   └── api/
│   │   │       ├── verify-key/
│   │   │       ├── purchase-key/
│   │   │       ├── register-device/
│   │   │       └── logs/
│   │   └── components/
│   ├── package.json
│   └── next.config.js
├── build/
├── logs/
├── .env.example
├── .gitignore
└── README.md
```

---

## Core Features (9 Functions)

### 1. License Key System
- App is locked behind a license key
- No key = no access (redirect to purchase page)
- Key entered at first launch, cached locally
- Validated against remote server on startup + periodically
- Device-bound: one key per machine (hardware ID fingerprint)
- Purchase flow opens admin panel website

### 2. Note & File Writer
- Write .md, .txt, .json, .js, .py, .html, .css files
- AI-assisted writing: user describes what they want → AI generates content
- Save to any location on filesystem (native file picker)
- Template system for common file types
- Preview mode for markdown

### 3. License Key Server (Admin Panel)
- REST API for key verification: `POST /api/verify-key`
- Accepts: license key + hardware ID
- Returns: valid/invalid + expiry + features
- Rate-limited, logged
- Part of Next.js admin panel

### 4. Prompt Writer Agent
- Technology: **nut.js** (cross-platform desktop automation)
- Alternative: **RobotJS** (simpler, less features)
- Flow:
  1. User triggers prompt writer via hotkey (e.g., Ctrl+Shift+P)
  2. Small overlay window appears
  3. User explains intent in local language (voice or text)
  4. AI asks clarifying questions
  5. AI generates detailed, structured prompt
  6. nut.js types the prompt into the active prompt box (ChatGPT, opencode, Claude, etc.)
- Works with any desktop app that has a text input field
- Language detection + prompt translated to English if needed

### 5. 10-Minute Free Trial
- First-time users get 10 minutes of full access
- Device fingerprinting collects:
  - Hardware ID (MAC + motherboard + disk serial hash)
  - IP address
  - OS version
  - App installation ID
- Trial state stored locally + synced to server
- Timer counts down in UI
- Blocked from running trial twice (server-side check)
- Trial timer pauses when app is minimized (optional)

### 6. Feedback After Free Trial
- When trial expires, user sees:
  1. "Your 10-minute trial has ended" screen
  2. Option to purchase license key (redirect to admin panel)
  3. Option to submit feedback
- Feedback form: rating (1-5) + optional text
- Feedback stored in admin panel database

### 7. Admin Panel (Next.js)
- Password-protected dashboard
- **Usage Reports**: per-user usage logs, timestamps, features used, terminal commands run, files written
- **User Management**: list users, block/unblock, view device fingerprints, trial status
- **License Management**: generate keys, set expiry, revoke keys, view activation count per key
- **Key Purchase**: Stripe/PayPal integration for buying keys
- **Key Verification API**: `POST /api/verify-key` endpoint
- **Feedback Dashboard**: view all submitted feedback
- **Live Logs**: real-time streaming logs from all connected agents

### 8. Terminal Full Command Access
- Full shell access (bash/zsh on Mac, PowerShell/cmd on Windows)
- Agent can execute any system command
- **Retry mechanism**:
  - On failure → auto-retry up to 3 times with exponential backoff
  - Each retry logs the attempt + error
  - If all retries fail → return error + suggestion
- Command history stored locally
- Safety confirmation for destructive commands (rm -rf, format, dd, etc.)
- Output streaming to UI in real-time

---

## Design System — HeroUI v3 + Tailwind v4

### Stack
- **Tailwind CSS v4** — utility-first CSS (latest features: container queries, @theme directive)
- **HeroUI v3** — component library built on Tailwind CSS v4 + React Aria, 75+ accessible components

### Theme Variables (CSS Custom Properties)

```css
/* Light mode (default) */
:root {
  --background: #FFFFFF;
  --foreground: #09090B;
  --card: #FFFFFF;
  --card-foreground: #09090B;
  --popover: #FFFFFF;
  --popover-foreground: #09090B;
  --primary: #18181B;
  --primary-foreground: #FAFAFA;
  --secondary: #F4F4F5;
  --secondary-foreground: #18181B;
  --muted: #F4F4F5;
  --muted-foreground: #71717A;
  --accent: #F4F4F5;
  --accent-foreground: #18181B;
  --destructive: #EF4444;
  --destructive-foreground: #FAFAFA;
  --border: #E4E4E7;
  --input: #E4E4E7;
  --ring: #18181B;
  --radius: 0.5rem;
}

/* Dark mode */
.dark {
  --background: #09090B;
  --foreground: #FAFAFA;
  --card: #09090B;
  --card-foreground: #FAFAFA;
  --popover: #09090B;
  --popover-foreground: #FAFAFA;
  --primary: #FAFAFA;
  --primary-foreground: #18181B;
  --secondary: #27272A;
  --secondary-foreground: #FAFAFA;
  --muted: #27272A;
  --muted-foreground: #A1A1AA;
  --accent: #27272A;
  --accent-foreground: #FAFAFA;
  --destructive: #7F1D1D;
  --destructive-foreground: #FAFAFA;
  --border: #27272A;
  --input: #27272A;
  --ring: #D4D4D8;
}
```

### UI Vibe — Desktop Agent
- Dark mode default (agent-like terminal aesthetic)
- Light mode available (toggle in settings)
- Compact layout — no wasted space
- Monospace font in terminal + code blocks
- Voice command bar pinned at bottom (always visible)
- Agent status dot in sidebar (idle/listening/thinking/speaking)
- Command palette (Cmd+K) for quick actions

### HeroUI v3 Components Used
`Button`, `Tooltip`, `Separator`, `Card`, `Input`, `Avatar`, `Switch`, `Select`, `Dialog`, `Tabs`, `Badge`, `ScrollArea`, `DropdownMenu`, `Sheet` (sidebar)

---

## Phases

### Phase 1 — Scaffolding
- [x] Initialize Electron + React project — `frontend/` with Vite, Electron, HeroUI
- [x] Python backend skeleton with FastAPI — `backend/` with routes, Gemini Live, config
- [x] Agent skeleton — `agent/` with automation deps
- [x] Next.js admin panel skeleton — `admin/` with login, dashboard, licenses, users, verify-key API
- [x] Directory structure, .gitignore, configs
- [x] CI/CD setup for Mac + Windows builds — `.github/workflows/` with build-mac, build-windows, backend, release

### Phase 2 — Backend Core
- [x] FastAPI routes for all 24 endpoints (chat, memory, settings, system, voice, terminal, notes, license, trial, feedback)
- [x] Chat route — in-memory conversation storage with conversation management
- [x] Memory route — CRUD with JSON file persistence
- [x] Settings route — API key management with JSON file persistence
- [x] Gemini Live integration — WebSocket relay (Phase 1, already implemented)
- [x] License verification middleware — `X-License-Key` + `X-Hardware-Id` header check
- [x] Trial tracker — hardware-ID-based 10-min trial with JSON persistence
- [x] Terminal executor — `asyncio.create_subprocess_shell` with 3-retry + dangerous command detection
- [x] File writer service — allowed extensions validation, directory creation
- [x] Prompt writer service — skeleton for Phase 5
- [x] Feedback route — rating + text submission with JSON persistence

### Phase 3 — Electron Desktop App
- Main process: system tray, background service, IPC
- Renderer: white theme UI, all pages
- Window management: minimize-to-tray, close-to-tray
- Auto-launch on startup option
- electron-updater for auto-updates

### Phase 4 — License + Trial System
- License key client (enter key, cache, verify)
- 10-minute trial with device fingerprint
- Timer UI with countdown
- Trial expiry → purchase/feedback screen
- Server-side trial block (same device cannot retry)

### Phase 5 — Prompt Writer Agent
- nut.js integration for cross-platform automation
- Hotkey detection (global shortcut via Electron)
- Overlay UI for prompt explanation
- AI prompt generation + typing into target app
- Support for: ChatGPT desktop, Claude, opencode, browser chat apps

### Phase 6 — Notes (Agent Terminal Only)
- No frontend page needed
- Agent writes files via terminal: `echo "content" > path/file.txt`
- Agent opens files in OS default app: `open` (Mac) / `start` (Windows)
- All existing features (file_writer, terminal_exec, tool_executor) already support this

### Phase 7 — Admin Panel (Next.js)
- Authentication (password or OAuth)
- User management CRUD
- License key generation + management
- Usage logs + analytics dashboard
- Feedback viewer
- Stripe/PayPal checkout integration
- Key verification API

### Phase 8 — Packaging & Distribution
- Electron builder config for Mac (DMG) + Windows (NSIS)
- Code signing (macOS notarization + Windows Authenticode)
- Auto-update channel (GitHub Releases)
- Python backend bundled with PyInstaller
- Combined installer (Electron + Python backend)

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron (main process) |
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS v4 + HeroUI v3 |
| State | Zustand |
| Backend | Python + FastAPI |
| AI | Google Gemini (Live API) |
| Desktop Automation | nut.js (cross-platform) |
| Admin Panel | Next.js |
| Database (admin) | PostgreSQL or SQLite |
| Database (local) | SQLite |
| Auth (admin) | NextAuth or JWT |
| Payments | Stripe / PayPal |
| Packaging | electron-builder + PyInstaller |
| Auto-Update | electron-updater |

---

## Platform Support

| Feature | macOS | Windows |
|---------|-------|---------|
| System tray | ✅ | ✅ |
| Auto-launch | ✅ | ✅ |
| Terminal (bash/zsh) | ✅ | ✅ (PowerShell) |
| nut.js automation | ✅ | ✅ |
| File picker | ✅ | ✅ |
| Global hotkey | ✅ | ✅ |
| Code signing | ✅ (notarization) | ✅ (Authenticode) |
| Installer | DMG | NSIS |

---

## Milestone Summary

| Phase | Duration | Milestone |
|-------|----------|-----------|
| 1. Scaffolding | 1 week | Project structure, all apps skeleton |
| 2. Backend Core | 2 weeks | All 24 FastAPI endpoints, Gemini Live, license/trial middleware |
| 3. Electron App | 2 weeks | Tray, white theme UI, all pages |
| 4. License + Trial | 1 week | Key system, 10-min trial, device fingerprint |
| 5. Prompt Writer | 2 weeks | nut.js automation, overlay, AI prompt gen |
| 6. Notes | — | Agent terminal: echo/redirect to file, open/start to view |
| 7. Admin Panel | 2 weeks | Next.js, user mgmt, keys, payments, logs |
| 8. Packaging | 2 weeks | Builds, signing, auto-update, installers |

**Total: ~13 weeks (3 months)**

---

## Auto-Update Path — 5 Phase Plan (issues #13 → #31 → #32 → #29 → #33)

Goal: updater running → backend ships → combined installer → mac signed → release automation.

### Phase 1 — #13 Auto-update (electron-updater) — IN PROGRESS
- [x] `npm i electron-updater` (regular dep)
- [x] `electron-builder.yml`: `publish: {provider: github, owner: Itsnishant4, repo: woxus-agent, token: ${env.GH_TOKEN}}`; mac adds `zip` target (updater needs latest-mac.yml + blockmap)
- [x] `frontend/electron/updaterService.ts` (new): init only packaged or `--update-dev`; macOS gated behind signing flag; autoDownload; events → `update:status` IPC (checking/available/progress/downloaded/none/error); `installUpdate()` → `quitAndInstall()` (backend stops via before-quit); silent check 10s post-ready
- [x] `main.ts`: `update:check` / `update:install` IPC + `update:status` push + `app:get-version`
- [x] `preload.ts`: `checkForUpdates`, `installUpdate`, `onUpdateStatus`, `getAppVersion`
- [x] `SettingsPage.tsx`: update card — version, Check button, status, progress bar, Restart & Update
- [x] `release.yml`: drop softprops; electron-builder self-publishes (GH_TOKEN); matrix macos+windows+ubuntu
- [x] `dev-app-update.yml` + local http.server test loop (package 0.1.0 → serve → bump 0.1.1 → `--update-dev` → check/download/install)
- [ ] GitHub release E2E: real tag → fresh install old version → auto-update to new

### Phase 2 — #31 PyInstaller backend bundling
- [ ] Relocate `DATA_DIR` (license.py, memory_engine.py, trial_tracker.py) to `~/.woxus/data` — **prevents data wipe on update**
- [ ] `backend/woxus_backend.spec`: one-folder; hidden imports llama_cpp / ctranslate2 / faster_whisper; exclude dev junk
- [ ] CI pyinstaller job per OS (mac/win/ubuntu) → backend-dist artifact
- [ ] `electron-builder.yml`: `extraResources: backend-dist`
- [ ] `backendManager.ts`: packaged mode spawns bundled binary (`.exe` on win), passes GEMINI_API_KEY / GEMINI_MODEL / WOXUS_DATA_DIR
- [ ] SettingsPage API key field → electron-store → backend env (packaged apps have no .env)
- [ ] Verify per OS: backend boots, license+memory persist across reinstall, prompt writer works

### Phase 3 — #32 Combined installer
- [ ] Confirm DMG/NSIS/AppImage carry backend via extraResources (no separate artifact needed)
- [ ] Verify NSIS Program Files install (data stays in ~/.woxus), DMG drag-install, AppImage

### Phase 4 — #29 macOS code signing + notarization (external creds)
- [ ] Apple Developer Program cert ($99/yr); secrets: CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
- [ ] electron-builder `mac.notarize` + `hardenedRuntime: true`
- [ ] Flip macOS updater gate flag
- [ ] Without cert: mac updates stay dormant; Windows/Linux ship first

### Phase 5 — #33 Release automation (polish)
- [ ] Version bump helper, changelog generation, draft-release approval
- [ ] Keep existing tag flow; add scheduled smoke test

---

## Immediate Next Steps

1. [x] Scaffold Electron + React frontend
2. [x] Scaffold Python FastAPI backend
3. [x] Build admin/ directory with Next.js
4. [x] CI/CD — GitHub Actions for Mac + Windows + backend
5. [ ] Add system tray + background service (Phase 3)
6. [x] Implement license gate (Phase 4)
7. [x] Backend endpoint implementation (Phase 2)
8. [x] Notes — agent writes/opens files via terminal (no page needed)
9. [ ] Prompt Writer Agent (Phase 5)
10. [ ] Packaging & Distribution (Phase 8)
