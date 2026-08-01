import { app } from 'electron';
// electron-updater is CJS; Node's ESM lexer cannot statically detect its named
// exports, so use a default import and destructure instead.
import electronUpdater from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';

const { autoUpdater } = electronUpdater;

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
  | { status: 'none' }
  | { status: 'error'; error: string };

type StatusSink = (state: UpdateStatus) => void;

let initialized = false;

export function initAutoUpdater(sink: StatusSink): void {
  if (initialized) return;
  initialized = true;

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
    console.error('[updater] error:', err.message);
    sink({ status: 'error', error: err.message });
  });
  autoUpdater.on('update-cancelled', () => {
    sink({ status: 'available', version: '' });
  });

  // Silent check shortly after startup (no user prompt if none available).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err);
      sink({ status: 'error', error: String(err) });
    });
  }, 10_000);
}

export async function checkForUpdates(): Promise<void> {
  await autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] check failed:', err);
  });
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate().catch((err) => {
    console.error('[updater] download failed:', err);
  });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
