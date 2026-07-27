const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const isWin = os.platform() === 'win32';

function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

// Detect Python path (cross-platform venv)
const pythonPath = isWin
  ? path.join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, 'backend', '.venv', 'bin', 'python');

// Start Python backend
const backend = spawn(
  pythonPath,
  ['-m', 'uvicorn', 'backend.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  }
);

backend.on('error', (err) => log('Backend', `Failed to start: ${err.message}`));
backend.on('exit', (code) => {
  log('Backend', `Exited (code ${code})`);
  process.exit();
});

log('Backend', 'Starting uvicorn...');

// Wait a moment for backend to start, then launch Electron
setTimeout(() => {
  const electron = spawn(
    isWin ? 'npm.cmd' : 'npm',
    ['run', 'electron:dev'],
    {
      cwd: path.join(ROOT, 'frontend'),
      stdio: 'inherit',
      shell: false,
      env: { ...process.env },
    }
  );

  electron.on('error', (err) => log('Electron', `Failed: ${err.message}`));
  electron.on('exit', () => {
    log('Electron', 'Closed');
    backend.kill();
    process.exit();
  });

  log('Electron', 'Starting Vite + Electron...');
}, 3000);

process.on('SIGINT', () => {
  log('Dev', 'Shutting down...');
  backend.kill();
  process.exit();
});
