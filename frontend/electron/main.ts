import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, globalShortcut, screen, type NativeImage } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { settingsStore } from './store.js';
import { BackendManager } from './backendManager.js';
import { verifyLicense, getLicenseStatus, getTrialStatus, startTrial, submitFeedback, getHardwareId } from './licenseIpc.js';
import { initAutoUpdater, checkForUpdates, downloadUpdate, installUpdate, UpdateStatus } from './updaterService.js';
import { pasteText, getActiveWindowTitle, saveActiveWindow, restoreActiveWindow } from './pasteService.js';
import { checkPermission, openPermissionSettings } from './permissionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function iconPath(...segments: string[]): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icons', ...segments);
  }
  return join(__dirname, '..', '..', ...(VITE_DEV_SERVER_URL ? ['dev-icons', ...segments] : ['icons', ...segments]));
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let orbWindows: BrowserWindow[] = [];
let tray: Tray | null = null;
let isQuitting = false;

function createWindow() {
  const iconFile = process.platform === 'darwin' ? 'icon-transparent.png' : 'windows/icon.ico';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Woxus',
    icon: iconPath(iconFile),
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: http://localhost:* http://127.0.0.1:*; font-src 'self' data:;"],
      },
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(VITE_DEV_SERVER_URL || 'http://localhost:5173') && !url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('ready-to-show', () => {
    const settings = app.getLoginItemSettings() as any;
    const launchedAtLogin = process.platform === 'darwin' && !!settings?.wasLaunchedAtLogin;
    if (!process.argv.includes('--hidden') && !launchedAtLogin) {
      mainWindow?.show();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Show the orb whenever the main window is hidden/minimized; hide it when shown
  mainWindow.on('hide', () => setOrbVisible(true));
  mainWindow.on('minimize', () => setOrbVisible(true));
  mainWindow.on('show', () => setOrbVisible(false));

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }
}

const ORB_SIZE = 64;

function setOrbVisible(visible: boolean) {
  for (const win of orbWindows) {
    if (visible && !win.isVisible()) {
      win.showInactive();
    } else if (!visible && win.isVisible()) {
      win.hide();
    }
  }
}

function createOrbWindow(display: Electron.Display) {
  const { workArea } = display;

  const orb = new BrowserWindow({
    width: ORB_SIZE,
    height: ORB_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  // Keep the orb above regular windows without stealing focus
  orb.setAlwaysOnTop(true, 'screen-saver');
  orb.setPosition(
    workArea.x + workArea.width - ORB_SIZE - 24,
    workArea.y + workArea.height - ORB_SIZE - 24,
  );

  orb.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      orb.hide();
    }
  });

  if (VITE_DEV_SERVER_URL) {
    orb.loadURL(VITE_DEV_SERVER_URL + '#/orb');
  } else {
    orb.loadFile(join(__dirname, '../dist/index.html'), { hash: '/orb' });
  }

  orbWindows.push(orb);
}

function createOrbWindows() {
  for (const display of screen.getAllDisplays()) {
    createOrbWindow(display);
  }
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 650,
    height: 400,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  overlayWindow.on('blur', () => {
    overlayWindow?.hide();
  });

  if (VITE_DEV_SERVER_URL) {
    overlayWindow.loadURL(VITE_DEV_SERVER_URL + '#/overlay');
  } else {
    overlayWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: '/overlay' });
  }
}

function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = settingsStore.getGlobalHotkey() || 'CommandOrControl+Shift+P';
  try {
    globalShortcut.register(hotkey, () => {
      if (overlayWindow) {
        if (overlayWindow.isVisible()) {
          overlayWindow.hide();
        } else {
          overlayWindow.show();
          overlayWindow.focus();
          saveActiveWindow();
        }
      }
    });
  } catch (err) {
    console.error('Failed to register global hotkey:', err);
  }
}

let permissionPollTimer: ReturnType<typeof setInterval> | null = null;

function startPermissionPoller() {
  if (permissionPollTimer) return;
  permissionPollTimer = setInterval(() => {
    if (checkPermission().ok) {
      if (permissionPollTimer) {
        clearInterval(permissionPollTimer);
        permissionPollTimer = null;
      }
      registerGlobalHotkey();
    }
  }, 2000);
}


function createTray() {
  let icon: NativeImage;
  if (process.platform === 'darwin') {
    icon = nativeImage.createFromPath(iconPath('tray-icon.png')).resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);
  } else {
    icon = nativeImage.createFromPath(iconPath('tray', 'tray-icon-32.png'));
  }
  tray = new Tray(icon);
  tray.setToolTip('Woxus Agent');

  function updateMenu() {
    // In dev mode, assume backend is running (dev.js manages it)
    const state = app.isPackaged
      ? BackendManager.getInstance().getState()
      : { isRunning: true };
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Woxus', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      { label: state.isRunning ? 'Backend: Running' : 'Backend: Stopped', enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray?.setContextMenu(contextMenu);
  }

  updateMenu();
  // Don't auto-show window on tray click — user opens via context menu
  // Clicking the tray icon only reveals the context menu (macOS default)
}

app.whenReady().then(async () => {
  // Single instance lock (reference: prompt-enhancer/main.ts)
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Apply persisted auto-launch setting on every startup (reference: prompt-enhancer/main.ts)
  const savedLaunch = settingsStore.getLaunchAtLogin();
  if (savedLaunch) {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    } else {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: false });
  }

  // Start backend manager for packaged builds
  const backendManager = BackendManager.getInstance();
  if (app.isPackaged) {
    try {
      await backendManager.start();
    } catch (err) {
      console.error('[main] Failed to start backend:', err);
    }
  }

  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath('icon-transparent.png')));
  }

  createWindow();
  createOverlayWindow();
  createOrbWindows();
  createTray();
  // Gate the global hotkey (and paste automation) behind macOS Accessibility
  // permission. Once granted, the poller re-registers it automatically.
  if (process.platform === 'darwin' && !checkPermission().ok) {
    startPermissionPoller();
  } else {
    registerGlobalHotkey();
  }
  initAutoUpdater((state: UpdateStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:status', state);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Second instance handler (reference: prompt-enhancer/main.ts)
app.on('second-instance', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

app.on('before-quit', () => {
  isQuitting = true;
  // Stop backend on quit (packaged mode only)
  if (app.isPackaged) {
    BackendManager.getInstance().stop();
  }
});

app.on('will-quit', () => {
  if (permissionPollTimer) {
    clearInterval(permissionPollTimer);
    permissionPollTimer = null;
  }
  globalShortcut.unregisterAll();
});

// Synchronous so the renderer can resolve its API base URL at module load
// (the backend port is chosen in BackendManager.start() before any window is
// created). Used by src/services/api.ts, gemini-client.ts and OverlayPage.
ipcMain.on('backend:get-port', (event) => {
  event.returnValue = BackendManager.getInstance().getPort();
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('update:check', () => {
  checkForUpdates();
  return true;
});

ipcMain.handle('update:download', () => {
  downloadUpdate();
  return true;
});

ipcMain.handle('update:install', () => {
  installUpdate();
  return true;
});

ipcMain.handle('get-auto-launch', () => {
  return settingsStore.getLaunchAtLogin();
});

ipcMain.handle('set-auto-launch', (_event, enable: boolean) => {
  settingsStore.setLaunchAtLogin(enable);
  if (enable && process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  } else if (enable) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
  } else {
    app.setLoginItemSettings({ openAtLogin: false });
  }
  return settingsStore.getLaunchAtLogin();
});

ipcMain.handle('get-global-hotkey', () => settingsStore.getGlobalHotkey());
ipcMain.handle('set-global-hotkey', (_event, hotkey: string) => {
  settingsStore.setGlobalHotkey(hotkey);
  registerGlobalHotkey();
});

ipcMain.handle('get-api-key', () => settingsStore.getApiKey());
ipcMain.handle('set-api-key', (_event, key: string) => {
  settingsStore.setApiKey(String(key));
  return settingsStore.getApiKey();
});
ipcMain.handle('get-gemini-model', () => settingsStore.getGeminiModel());
ipcMain.handle('set-gemini-model', (_event, model: string) => {
  settingsStore.setGeminiModel(String(model));
  return settingsStore.getGeminiModel();
});
ipcMain.on('hide-overlay', () => {
  overlayWindow?.hide();
});

// Orb click → toggle main window visibility
ipcMain.on('orb-toggle-main', () => {
  // Remember what was focused BEFORE we show/steal focus to Woxus, so a later
  // paste can restore the user's previous window (their editor/terminal).
  // Must run BEFORE mainWindow.show()+focus() or we'd capture Woxus itself.
  saveActiveWindow();
  if (mainWindow?.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow?.show();
    mainWindow?.focus();
  }
});

// License IPC handlers
ipcMain.handle('hardware:get-id', () => getHardwareId());

ipcMain.handle('license:verify', (_event, licenseKey: string) => verifyLicense(licenseKey));

ipcMain.handle('license:get-status', () => getLicenseStatus());

ipcMain.handle('trial:status', () => getTrialStatus());

ipcMain.handle('trial:start', (_event, email: string) => startTrial(email));

ipcMain.handle('feedback:submit', (_event, rating: number, text: string) => submitFeedback(rating, text));

// Prompt paste (nut.js) — restores focus to the pre-overlay window, then pastes
ipcMain.handle('agent:paste', async (_event, text: string) => {
  await restoreActiveWindow();
  return pasteText(String(text));
});

ipcMain.handle('agent:active-window', () => getActiveWindowTitle());

// Automation permission (macOS Accessibility)
ipcMain.handle('permission:check', () => checkPermission());
ipcMain.handle('permission:open-settings', () => {
  openPermissionSettings();
  return checkPermission();
});
// macOS requires the app to RESTART after granting Accessibility before
// isTrustedAccessibilityClient returns true. The gate offers this button.
ipcMain.handle('app:restart', () => {
  app.relaunch();
  app.exit(0);
});
