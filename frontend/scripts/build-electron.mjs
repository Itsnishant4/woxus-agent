import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

execSync('npx tsc -p tsconfig.electron.json', {
  cwd: root,
  stdio: 'inherit',
});
