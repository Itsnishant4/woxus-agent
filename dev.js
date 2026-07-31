const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = __dirname;
const LOG_FILE = path.join(ROOT, 'woxus.log');
const isWin = os.platform() === 'win32';

// Clear woxus.log file every time the app restarts
fs.writeFileSync(LOG_FILE, `=== Woxus Log Started at ${new Date().toISOString()} ===\n`, { flag: 'w' });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function log(tag, msg) {
  const text = `[${tag}] ${msg}`;
  console.log(text);
  logStream.write(text + '\n');
}

function attachLogging(proc) {
  if (proc.stdout) {
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      logStream.write(text);
    });
  }
  if (proc.stderr) {
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      logStream.write(text);
    });
  }
}

// Spawn a process without crashing the whole script on spawn errors
// (ENOENT missing binary, EINVAL invalid options, etc.)
function safeSpawn(file, args, opts, tag) {
  try {
    const proc = spawn(file, args, opts);
    attachLogging(proc);
    proc.on('error', (err) => log(tag, `Failed to start: ${err.message}`));
    return proc;
  } catch (err) {
    log(tag, `Failed to start: ${err.message}`);
    return null;
  }
}

function runSync(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    return r.status === 0;
  } catch {
    return false;
  }
}

// Detect Python path (cross-platform venv or fallback to system python)
const venvDir = path.join(ROOT, 'backend', '.venv');
const venvPythonPath = isWin
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

// Find a usable system Python (Windows: try py launcher first)
function findSystemPython() {
  const candidates = isWin ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const c of candidates) {
    try {
      const r = spawnSync(c[0], c.slice(1).concat('--version'), { stdio: 'ignore' });
      if (r.status === 0) return c;
    } catch { /* try next */ }
  }
  return null;
}

// Bootstrap the venv if it does not exist yet (common on fresh clones)
if (!fs.existsSync(venvPythonPath)) {
  log('Backend', `Virtual environment not found: ${venvPythonPath}`);
  const sysPython = findSystemPython();
  if (!sysPython) {
    log('Backend', 'No system Python found. Install Python 3.10+ and re-run.');
    process.exit(1);
  }
  log('Backend', `Creating virtual environment with: ${sysPython.join(' ')} -m venv backend/.venv ...`);
  if (!runSync(sysPython[0], sysPython.slice(1).concat(['-m', 'venv', venvDir]), { cwd: ROOT })) {
    log('Backend', 'Failed to create virtual environment. Create it manually, then re-run:');
    log('Backend', isWin ? '  python -m venv backend\\.venv' : '  python3 -m venv backend/.venv');
    process.exit(1);
  }
  log('Backend', 'Virtual environment created.');
}

const pythonPath = fs.existsSync(venvPythonPath) ? venvPythonPath : (isWin ? 'python.exe' : 'python');

// Install requirements only when a dependency is missing (first run on a
// fresh machine, or after requirements.txt changed)
const depsOk = runSync(pythonPath, ['-c', 'import uvicorn, fastapi, llama_cpp, faster_whisper'], { cwd: ROOT });
if (!depsOk) {
  log('Backend', 'Installing backend dependencies (first run, this may take a few minutes)...');
  if (!runSync(pythonPath, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(ROOT, 'backend', 'requirements.txt')], { cwd: ROOT })) {
    log('Backend', 'Dependency install failed. Install manually:');
    log('Backend', `  ${pythonPath} -m pip install -r backend/requirements.txt`);
    process.exit(1);
  }
}

// Start Python backend
const backend = safeSpawn(
  pythonPath,
  ['-m', 'uvicorn', 'backend.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  },
  'Backend'
);

backend?.on('exit', (code) => {
  log('Backend', `Exited (code ${code})`);
  process.exit();
});

log('Backend', 'Starting uvicorn...');

// Wait a moment for backend to start, then launch Electron
setTimeout(() => {
  let electron = null;
  if (isWin) {
    // npm.cmd without a shell first; retry with a shell if that fails
    electron = safeSpawn(
      'npm.cmd',
      ['run', 'electron:dev'],
      {
        cwd: path.join(ROOT, 'frontend'),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env },
      },
      'Electron'
    );
    if (!electron) {
      log('Electron', 'Retrying with shell...');
      electron = safeSpawn(
        'npm run electron:dev',
        [],
        {
          cwd: path.join(ROOT, 'frontend'),
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
          windowsHide: true,
          env: { ...process.env },
        },
        'Electron'
      );
    }
  } else {
    electron = safeSpawn(
      'npm',
      ['run', 'electron:dev'],
      {
        cwd: path.join(ROOT, 'frontend'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      },
      'Electron'
    );
  }

  electron?.on('exit', () => {
    log('Electron', 'Closed');
    backend?.kill();
    process.exit();
  });

  log('Electron', 'Starting Vite + Electron...');
}, 3000);

process.on('SIGINT', () => {
  log('Dev', 'Shutting down...');
  backend?.kill();
  process.exit();
});
