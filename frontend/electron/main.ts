import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, globalShortcut } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { settingsStore } from './store.js';
import { BackendManager } from './backendManager.js';
import { verifyLicense, getLicenseStatus, getTrialStatus, startTrial, submitFeedback, getHardwareId } from './licenseIpc.js';

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

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
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
        }
      }
    });
  } catch (err) {
    console.error('Failed to register global hotkey:', err);
  }
}


function createTray() {
  const trayIconFile = process.platform === 'darwin' ? 'tray-icon.png' : 'tray-icon-32.png';
  let icon = nativeImage.createFromPath(iconPath(trayIconFile));
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 22, height: 22 });
    icon.setTemplateImage(true);
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
  createTray();
  registerGlobalHotkey();

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
  globalShortcut.unregisterAll();
});

ipcMain.handle('get-app-version', () => app.getVersion());

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
ipcMain.on('hide-overlay', () => {
  overlayWindow?.hide();
});

// License IPC handlers
ipcMain.handle('hardware:get-id', () => getHardwareId());

ipcMain.handle('license:verify', (_event, licenseKey: string) => verifyLicense(licenseKey));

ipcMain.handle('license:get-status', () => getLicenseStatus());

ipcMain.handle('trial:status', () => getTrialStatus());

ipcMain.handle('trial:start', (_event, email: string) => startTrial(email));

ipcMain.handle('feedback:submit', (_event, rating: number, text: string) => submitFeedback(rating, text));
