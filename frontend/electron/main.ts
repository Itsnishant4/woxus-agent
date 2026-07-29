import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
    mainWindow?.show();
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

function createTray() {
  const trayIconFile = process.platform === 'darwin' ? 'tray-icon.png' : 'tray-icon-32.png';
  let icon = nativeImage.createFromPath(iconPath(trayIconFile));
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 22, height: 22 });
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  tray.setToolTip('Woxus Agent');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Woxus', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath('icon-transparent.png')));
  }
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

ipcMain.handle('get-app-version', () => app.getVersion());
