import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('set-auto-launch', enable),
  getGlobalHotkey: () => ipcRenderer.invoke('get-global-hotkey'),
  setGlobalHotkey: (hotkey: string) => ipcRenderer.invoke('set-global-hotkey', hotkey),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  toggleMainWindow: () => ipcRenderer.send('orb-toggle-main'),
  platform: process.platform,

  // Automation permission
  getPermissionStatus: () => ipcRenderer.invoke('permission:check'),
  openPermissionSettings: () => ipcRenderer.invoke('permission:open-settings'),

  // Prompt paste
  agentPaste: (text: string) => ipcRenderer.invoke('agent:paste', text),
  getActiveWindowTitle: () => ipcRenderer.invoke('agent:active-window'),

  // License IPC
  getHardwareId: () => ipcRenderer.invoke('hardware:get-id'),
  verifyLicense: (licenseKey: string) => ipcRenderer.invoke('license:verify', licenseKey),
  getLicenseStatus: () => ipcRenderer.invoke('license:get-status'),
  getTrialStatus: () => ipcRenderer.invoke('trial:status'),
  startTrial: (email: string) => ipcRenderer.invoke('trial:start', email),
  submitFeedback: (rating: number, text: string) => ipcRenderer.invoke('feedback:submit', rating, text),
});
