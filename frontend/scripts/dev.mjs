import { createServer } from 'vite';
import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

async function start() {
  console.log('[Dev] Building Electron scripts...');
  execSync('npx tsc -p tsconfig.electron.json', { cwd: root, stdio: 'inherit' });

  const server = await createServer({ configFile: './vite.config.ts', root });
  await server.listen();

  const address = server.httpServer.address();
  const port = typeof address === 'object' ? address.port : 5173;

  const electronPath = require('electron');
  const child = spawn(electronPath, [root], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `http://localhost:${port}`,
    },
    stdio: 'inherit',
    cwd: root,
  });

  child.on('close', () => {
    server.close();
    process.exit();
  });

  process.on('SIGINT', () => {
    child.kill();
    server.close();
    process.exit();
  });
}

start();
