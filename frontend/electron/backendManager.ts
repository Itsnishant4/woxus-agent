import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { settingsStore } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface BackendState {
  isRunning: boolean;
  pid?: number;
  error?: string;
}

let backendProcess: ChildProcess | null = null;

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
    args: ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'],
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

  async start(): Promise<void> {
    if (backendProcess || this.state.isRunning) {
      return;
    }

    if (!app.isPackaged) {
      console.log('[BackendManager] Skipped in dev mode');
      return;
    }

    const { bin, args, cwd } = getBackendLaunch();
    console.log('[BackendManager] Starting backend...', { bin, cwd });

    try {
      backendProcess = spawn(bin, args, {
        cwd,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          // Packaged apps have no .env — inject keys persisted in settings
          GEMINI_API_KEY: settingsStore.getApiKey() || process.env.GEMINI_API_KEY || '',
          GEMINI_MODEL: settingsStore.getGeminiModel() || process.env.GEMINI_MODEL || '',
          LICENSE_SERVER_URL: process.env.LICENSE_SERVER_URL || 'https://woxus-admin.vercel.app',
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