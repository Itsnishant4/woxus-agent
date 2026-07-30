import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface BackendState {
  isRunning: boolean;
  pid?: number;
  error?: string;
}

let backendProcess: ChildProcess | null = null;

function getPythonPath(): string {
  const isWindows = process.platform === 'win32';
  const base = join(__dirname, '..', '..', 'backend');
  return isWindows
    ? join(base, '.venv', 'Scripts', 'python.exe')
    : join(base, '.venv', 'bin', 'python');
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

    const pythonPath = getPythonPath();
    console.log('[BackendManager] Starting Python backend...', { pythonPath });

    try {
      backendProcess = spawn(pythonPath, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: join(__dirname, '..', '..'),
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
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