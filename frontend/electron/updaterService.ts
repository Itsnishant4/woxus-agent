import { app } from 'electron';
// electron-updater is CJS; Node's ESM lexer cannot statically detect its named
// exports, so use a default import and destructure instead.
import electronUpdater from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';

const { autoUpdater } = electronUpdater;

// macOS auto-update requires a code-signed + notarized app (issue #29).
// Until that lands, keep macOS production updates dormant.
const MAC_UPDATES_ENABLED = false;

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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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

  // Silent check shortly after startup (no user prompt if none available).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err);
      sink({ status: 'error', error: String(err) });
    });
  }, 10_000);
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] check failed:', err);
  });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
