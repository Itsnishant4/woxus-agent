import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

execSync('npx esbuild electron/*.ts --outdir=dist-electron --platform=node --format=esm', {
  cwd: root,
  stdio: 'inherit',
  shell: true
});

// Post-build guard: fail if any compiled file uses a named ESM import from a
// CommonJS package (e.g. electron-updater) — those compile fine but crash in
// the packaged app. This makes CI catch it before release.
execSync('node scripts/check-electron-imports.mjs', {
  cwd: root,
  stdio: 'inherit',
});
