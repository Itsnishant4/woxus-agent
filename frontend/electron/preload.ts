import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('set-auto-launch', enable),
  getGlobalHotkey: () => ipcRenderer.invoke('get-global-hotkey'),
  setGlobalHotkey: (hotkey: string) => ipcRenderer.invoke('set-global-hotkey', hotkey),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  platform: process.platform,
});
