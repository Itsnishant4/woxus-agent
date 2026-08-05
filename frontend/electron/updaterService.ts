import { app, shell } from 'electron';
import { createRequire } from 'module';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';

// electron-updater is CommonJS. Loading it via createRequire guarantees we get
// the module.exports object directly — immune to ESM named-export detection
// (`import { autoUpdater } from 'electron-updater'` throws at runtime in the
// packaged app because Node's ESM loader can't statically see CJS named exports).
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

// In-place updates (Squirrel.Mac) work for unsigned apps that were already
// launched once (which clears Gatekeeper quarantine). Fresh downloads still
// show "unidentified developer", but updates to the running app apply fine.
const MAC_UPDATES_ENABLED = true;

export type UpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'mac-dmg-ready'; version: string }
  | { status: 'none' }
  | { status: 'error'; error: string };

type StatusSink = (state: UpdateStatus) => void;

// The DMG download flow (macOS) emits progress through the same sink.
let _sink: StatusSink | null = null;

// A 404 on GitHub's release feed means no release has been published yet
// (private repo). Treat it as "no update available" instead of an error.
function isNoReleaseError(err: unknown): boolean {
  return String((err as Error)?.message || err).includes('404');
}

let initialized = false;

export function initAutoUpdater(sink: StatusSink): void {
  if (initialized) return;
  initialized = true;
  _sink = sink;

  const devUpdate = process.argv.includes('--update-dev');
  if (!app.isPackaged && !devUpdate) {
    console.log('[updater] Skipped in dev mode (pass --update-dev to test)');
    return;
  }

  if (process.platform === 'darwin' && app.isPackaged && !MAC_UPDATES_ENABLED && !devUpdate) {
    console.log('[updater] macOS updates disabled until code signing (#29)');
    return;
  }

  // Manual control: no auto-download, no auto-install
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // --update-dev: point at a local update server.
  // Packaged apps always read resources/app-update.yml, so override via
  // setFeedURL when WOXUS_UPDATE_URL is provided; unpackaged runs use
  // dev-app-update.yml via forceDevUpdateConfig.
  if (devUpdate) {
    const updateUrl = process.env.WOXUS_UPDATE_URL;
    if (updateUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
    } else {
      autoUpdater.forceDevUpdateConfig = true;
    }
  }

  autoUpdater.on('checking-for-update', () => sink({ status: 'checking' }));
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    sink({ status: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => sink({ status: 'none' }));
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    sink({ status: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    sink({ status: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err: Error) => {
    if (isNoReleaseError(err)) {
      console.log('[updater] No published release (404) — updates disabled');
      sink({ status: 'none' });
      return;
    }
    console.error('[updater] error:', err.message);
    sink({ status: 'error', error: err.message });
  });
  autoUpdater.on('update-cancelled', () => {
    sink({ status: 'available', version: '' });
  });

  // Silent check shortly after startup (no user prompt if none available).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      if (isNoReleaseError(err)) {
        console.log('[updater] No published release (404) — updates disabled');
        sink({ status: 'none' });
        return;
      }
      console.error('[updater] check failed:', err);
      sink({ status: 'error', error: String(err) });
    });
  }, 10_000);
}

export async function checkForUpdates(): Promise<void> {
  await autoUpdater.checkForUpdates().catch((err: unknown) => {
    if (!isNoReleaseError(err)) console.error('[updater] check failed:', err);
  });
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate().catch((err: unknown) => {
    console.error('[updater] download failed:', err);
  });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}

/**
 * macOS update flow: we do NOT use Squirrel.Mac's silent in-place install —
 * ad-hoc signing makes its code-signature check fail ("code failed to satisfy
 * specified code requirement(s)"). Instead, download the version's .dmg to
 * ~/Downloads and open it, so the user drags Woxus onto Applications and clicks
 * Replace (Finder's standard update UX). Windows keeps silent NSIS updates.
 */
export function downloadMacDmg(version: string): void {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const base = 'https://github.com/Itsnishant4/woxus-releases/releases/download';
  const url = `${base}/v${version}/Woxus-${version}-${arch}.dmg`;
  const dest = path.join(app.getPath('downloads'), `Woxus-${version}-${arch}.dmg`);

  const fail = (e?: unknown) => {
    try {
      file.destroy();
    } catch {
      /* ignore */
    }
    _sink?.({ status: 'error', error: String((e as Error)?.message || e) });
  };

  const pipeToFile = (res: IncomingMessage) => {
    const total = Number(res.headers['content-length']) || 0;
    let received = 0;
    res.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (total > 0) {
        _sink?.({
          status: 'downloading',
          percent: Math.max(0, Math.min(99, Math.round((received / total) * 100))),
        });
      }
    });
    res.on('error', fail);
    res.pipe(file);
  };

  const file = fs.createWriteStream(dest);
  file.on('error', fail);
  file.on('finish', () => {
    file.close();
    _sink?.({ status: 'mac-dmg-ready', version });
    shell.openPath(dest).then((err) => {
      // openPath returns '' on success. Once the installer opens, let it a
      // moment to mount, then fully quit so the user can drag Woxus onto
      // Applications and click Replace without the app still running.
      if (!err) {
        setTimeout(() => app.quit(), 3000);
      }
    }).catch(() => {});
  });

  https
    .get(url, (res) => {
      const code = res.statusCode ?? 0;
      // GitHub release downloads redirect (302) to a CDN — follow it.
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        https.get(res.headers.location, pipeToFile).on('error', fail);
        return;
      }
      if (code !== 200) {
        res.resume();
        fail(new Error(`Download failed (HTTP ${code})`));
        return;
      }
      pipeToFile(res);
    })
    .on('error', fail);
}
