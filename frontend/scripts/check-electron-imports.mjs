#!/usr/bin/env node
/**
 * Post-build guard: fail the build if any compiled Electron main-process file
 * uses a named import from a CommonJS-only package.
 *
 * WHY: electron-updater (and several other deps) are CommonJS. TypeScript's
 * `.d.ts` declares named exports, so `tsc` compiles `import { autoUpdater } from
 * 'electron-updater'` without error — but at RUNTIME in the packaged app, Node's
 * ESM loader cannot statically detect CJS named exports and throws:
 *
 *   SyntaxError: The requested module 'electron-updater' does not provide an
 *   export named 'autoUpdater'
 *
 * This check scans the compiled dist-electron/*.js output and fails CI if any
 * such pattern survives. Load CJS modules via createRequire instead:
 *
 *   const require = createRequire(import.meta.url);
 *   const { autoUpdater } = require('electron-updater');
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = join(root, 'dist-electron');

// CJS packages that must never be imported with ESM named-import syntax.
const CJS_PACKAGES = ['electron-updater'];

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

// Strip // line comments and /* */ block comments so example code inside
// doc comments doesn't trigger false positives.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let failed = false;

const files = listJsFiles(distDir);
for (const file of files) {
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const pkg of CJS_PACKAGES) {
    // Matches:  import { x, y } from 'electron-updater'
    const re = new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s*['"]${pkg.replace('/', '\\/')}['"]`);
    const m = src.match(re);
    if (m) {
      failed = true;
      const rel = file.replace(root + '/', '');
      console.error(
        `\n❌ [check-electron-imports] ${rel} uses a named ESM import from CommonJS package '${pkg}':\n` +
        `   ${m[0].trim()}\n` +
        `   This compiles fine but CRASHES in the packaged app.\n` +
        `   Fix: use createRequire instead:\n` +
        `     const require = createRequire(import.meta.url);\n` +
        `     const { ... } = require('${pkg}');\n`
      );
    }
  }
}

if (failed) {
  console.error('❌ Electron import guard FAILED — fix the imports above, then rebuild.');
  process.exit(1);
}

console.log('✅ [check-electron-imports] no CJS named-imports in compiled output');
