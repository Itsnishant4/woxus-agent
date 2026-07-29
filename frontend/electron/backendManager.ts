import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import * as http from 'http';

export class BackendManager {
  private process: ChildProcess | null = null;
  private isQuitting = false;
  private restartTimeout: NodeJS.Timeout | null = null;
  private backendUrl = 'http://127.0.0.1:8000';
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  public async start(): Promise<void> {
    if (this.process) return;

    this.isQuitting = false;
    const isWin = process.platform === 'win32';
    
    // Resolve the python executable path
    const venvPythonPath = isWin
      ? join(this.rootPath, 'backend', '.venv', 'Scripts', 'python.exe')
      : join(this.rootPath, 'backend', '.venv', 'bin', 'python');
      
    // Fallback to system python if venv doesn't exist
    const pythonPath = existsSync(venvPythonPath) ? venvPythonPath : (isWin ? 'python.exe' : 'python');

    console.log('[BackendManager] Starting backend using:', pythonPath);

    this.process = spawn(
      pythonPath,
      ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'],
      {
        cwd: this.rootPath,
        stdio: 'inherit',
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      }
    );

    this.process.on('error', (err) => {
      console.error('[BackendManager] Failed to start:', err.message);
      this.handleCrash();
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[BackendManager] Process exited with code ${code} and signal ${signal}`);
      this.process = null;
      if (!this.isQuitting) {
        this.handleCrash();
      }
    });

    return this.waitForHealthCheck();
  }

  public async stop(): Promise<void> {
    this.isQuitting = true;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    
    if (this.process) {
      console.log('[BackendManager] Stopping backend process...');
      
      // Try graceful shutdown via API first
      try {
         await this.triggerGracefulShutdown();
      } catch (e) {
         // ignore
      }

      this.process.kill('SIGINT');
      this.process = null;
    }
  }

  private handleCrash() {
    if (this.isQuitting) return;
    
    console.log('[BackendManager] Backend crashed. Restarting in 3 seconds...');
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    
    this.restartTimeout = setTimeout(() => {
      this.start().catch(console.error);
    }, 3000);
  }

  private waitForHealthCheck(): Promise<void> {
    return new Promise((resolve, reject) => {
      const maxRetries = 30; // 30 seconds max
      let retries = 0;
      let interval: NodeJS.Timeout;

      const check = () => {
        if (this.isQuitting) {
          clearInterval(interval);
          return reject(new Error('Quitting before backend became healthy'));
        }

        http.get(`${this.backendUrl}/api/system/health`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const json = JSON.parse(data);
                if (json.status === 'ok') {
                  clearInterval(interval);
                  console.log('[BackendManager] Backend is healthy and ready!');
                  resolve();
                }
              } catch (e) {}
            }
          });
        }).on('error', (err) => {
          // Ignore connection refused while starting up
        });

        retries++;
        if (retries >= maxRetries) {
          clearInterval(interval);
          reject(new Error('Backend failed to become healthy in time.'));
        }
      };

      // Poll every 1 second
      interval = setInterval(check, 1000);
      check();
    });
  }

  private triggerGracefulShutdown(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.request(`${this.backendUrl}/api/system/shutdown`, { method: 'POST' }, (res) => {
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  }
}
