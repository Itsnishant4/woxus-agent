import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { settingsStore } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PREFERRED_PORT = 8457;
const MAX_PORT_TRIES = 20;

interface BackendState {
  isRunning: boolean;
  pid?: number;
  error?: string;
}

let backendProcess: ChildProcess | null = null;
let selectedPort = PREFERRED_PORT;

/** True if nothing is listening on 127.0.0.1:port. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Pick the port the backend will run on: prefer 8457, and if it's taken
 * (e.g. a leftover Woxus process), step up until a free one is found. The
 * chosen port is used everywhere via getPort() — the renderer reads it once
 * at startup through `backend:get-port`.
 */
async function pickFreePort(): Promise<number> {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + MAX_PORT_TRIES; p++) {
    if (await isPortFree(p)) return p;
  }
  return PREFERRED_PORT;
}

function getBackendLaunch(): { bin: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    // PyInstaller one-folder bundle shipped via extraResources
    const base = join(process.resourcesPath, 'backend');
    const bin = process.platform === 'win32'
      ? join(base, 'woxus-backend.exe')
      : join(base, 'woxus-backend');
    return { bin, args: [], cwd: base };
  }
  const base = join(__dirname, '..', '..', 'backend');
  const pythonPath = process.platform === 'win32'
    ? join(base, '.venv', 'Scripts', 'python.exe')
    : join(base, '.venv', 'bin', 'python');
  return {
    bin: pythonPath,
    args: ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(PREFERRED_PORT)],
    cwd: join(__dirname, '..', '..'),
  };
}

export class BackendManager {
  private static instance: BackendManager;
  private state: BackendState = { isRunning: false };

  private constructor() {}

  static getInstance(): BackendManager {
    if (!BackendManager.instance) {
      BackendManager.instance = new BackendManager();
    }
    return BackendManager.instance;
  }

  /** Port the backend is (or will be) listening on. Defaults to 8457. */
  getPort(): number {
    return selectedPort;
  }

  async start(): Promise<void> {
    if (backendProcess || this.state.isRunning) {
      return;
    }

    if (!app.isPackaged) {
      console.log('[BackendManager] Skipped in dev mode');
      return;
    }

    // Choose a free port BEFORE spawning so the whole app can use the same one.
    selectedPort = await pickFreePort();
    console.log(`[BackendManager] Picked backend port: ${selectedPort}`);

    const { bin, args, cwd } = getBackendLaunch();
    console.log('[BackendManager] Starting backend...', { bin, cwd });

    try {
      backendProcess = spawn(bin, args, {
        cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: {
          ...process.env,
          BACKEND_PORT: String(selectedPort),
          PYTHONUNBUFFERED: '1',
          // Packaged apps have no .env — inject keys persisted in settings
          GEMINI_API_KEYS: settingsStore.getApiKey() || process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '',
          GEMINI_API_KEY: settingsStore.getApiKey() || process.env.GEMINI_API_KEY || '',
          GEMINI_MODEL: settingsStore.getGeminiModel() || process.env.GEMINI_MODEL || '',
          LICENSE_SERVER_URL: process.env.LICENSE_SERVER_URL || 'https://woxus-a.vercel.app',
        },
      });

      backendProcess.on('error', (err) => {
        console.error('[BackendManager] Failed to start:', err.message);
        this.state.error = err.message;
        this.state.isRunning = false;
      });

      backendProcess.on('exit', (code) => {
        console.log('[BackendManager] Exited with code:', code);
        backendProcess = null;
        this.state.isRunning = false;
      });

      this.state.isRunning = true;
      console.log('[BackendManager] Started successfully');
    } catch (err) {
      console.error('[BackendManager] Start failed:', err);
      throw err;
    }
  }

  stop(): void {
    if (backendProcess) {
      console.log('[BackendManager] Stopping...');
      backendProcess.kill();
      backendProcess = null;
      this.state.isRunning = false;
    }
  }

  getState(): BackendState {
    return { ...this.state };
  }
}
