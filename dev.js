const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const isWin = os.platform() === 'win32';

function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

const electron = spawn(
  isWin ? 'npm.cmd' : 'npm',
  ['run', 'electron:dev'],
  {
    cwd: path.join(ROOT, 'frontend'),
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env },
  }
);

electron.on('error', (err) => log('Electron', `Failed: ${err.message}`));
electron.on('exit', () => {
  log('Electron', 'Closed');
  process.exit();
});

log('Electron', 'Starting Vite + Electron...');

process.on('SIGINT', () => {
  log('Dev', 'Shutting down...');
  process.exit();
});
