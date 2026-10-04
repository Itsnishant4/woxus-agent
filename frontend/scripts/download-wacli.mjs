// Download the matching wacli release archive into frontend/resources/wacli/
// so electron-builder bundles it (per-platform CI job downloads its own).
// Usage: node scripts/download-wacli.mjs [--os darwin|linux|win32] [--arch arm64|x64]
// Env: WACLI_VERSION (default v0.19.0, tested good).
import { mkdirSync, createWriteStream, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEST = join(__dirname, '..', 'resources', 'wacli');
const VERSION = process.env.WACLI_VERSION || 'v0.19.0';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const osName = arg('os', process.platform); // darwin | linux | win32
const archName = arg('arch', process.arch); // arm64 | x64
const osToken = osName === 'win32' ? 'windows' : osName === 'darwin' ? 'darwin' : 'linux';
const archToken = archName === 'x64' ? 'amd64' : 'arm64';
const ext = osToken === 'windows' ? '.zip' : '.tar.gz';

const apiBase = 'https://api.github.com/repos/openclaw/wacli/releases';
const relUrl = VERSION === 'latest' ? `${apiBase}/latest` : `${apiBase}/tags/${VERSION}`;
const res = await fetch(relUrl, {
  headers: { Accept: 'application/json', 'User-Agent': 'Woxus-Release' },
});
if (!res.ok) throw new Error(`GitHub API ${res.status} for ${relUrl}`);
const release = await res.json();
const tag = release.tag_name;
const want = `wacli_${tag.replace(/^v/, '')}_${osToken}_${archToken}${ext}`;
let asset = (release.assets || []).find((a) => a.name === want);
if (!asset) {
  asset = (release.assets || []).find(
    (a) => a.name.includes(`_${osToken}_${archToken}.`) && !a.name.includes('universal')
  );
}
if (!asset) {
  const names = (release.assets || []).map((a) => a.name).join(', ');
  throw new Error(`No wacli archive for ${osToken}/${archToken} in ${tag}. Have: ${names}`);
}
console.log(`[wacli] ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)`);

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
const archivePath = join(DEST, asset.name);
const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Woxus-Release' } });
if (!dl.ok || !dl.body) throw new Error(`Download failed: ${dl.status}`);
await pipeline(dl.body, createWriteStream(archivePath));

if (ext === '.zip') {
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${DEST}' -Force"`, { stdio: 'inherit' });
} else {
  execSync(`tar -xzf "${archivePath}" -C "${DEST}"`, { stdio: 'inherit' });
}
import('fs').then(({ unlinkSync }) => unlinkSync(archivePath));

// Flatten: move binary up if nested, drop everything else.
import { readdirSync, renameSync, statSync, chmodSync } from 'fs';
function findBin(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const f = findBin(p);
      if (f) return f;
    } else if (/^wacli(\.exe)?$/i.test(e)) return p;
  }
  return null;
}
const bin = findBin(DEST);
if (!bin) throw new Error('Archive had no wacli binary');
const finalName = osToken === 'windows' ? 'wacli.exe' : 'wacli';
const finalPath = join(DEST, finalName);
if (bin !== finalPath) renameSync(bin, finalPath);
// Keep only the binary (drop LICENSE/README extras from the archive).
for (const e of readdirSync(DEST)) {
  if (e !== finalName) rmSync(join(DEST, e), { recursive: true, force: true });
}
if (osToken !== 'windows') chmodSync(finalPath, 0o755);
console.log(`[wacli] bundled at ${finalPath}`);
