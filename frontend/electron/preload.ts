import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('set-auto-launch', enable),
  getGlobalHotkey: () => ipcRenderer.invoke('get-global-hotkey'),
  setGlobalHotkey: (hotkey: string) => ipcRenderer.invoke('set-global-hotkey', hotkey),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key: string) => ipcRenderer.invoke('set-api-key', key),
  getGeminiModel: () => ipcRenderer.invoke('get-gemini-model'),
  setGeminiModel: (model: string) => ipcRenderer.invoke('set-gemini-model', model),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  toggleMainWindow: () => ipcRenderer.send('orb-toggle-main'),
  platform: process.platform,

  // License IPC
  getHardwareId: () => ipcRenderer.invoke('hardware:get-id'),
  verifyLicense: (licenseKey: string) => ipcRenderer.invoke('license:verify', licenseKey),
  getLicenseStatus: () => ipcRenderer.invoke('license:get-status'),
  getTrialStatus: () => ipcRenderer.invoke('trial:status'),
  startTrial: (email: string) => ipcRenderer.invoke('trial:start', email),
  submitFeedback: (rating: number, text: string) => ipcRenderer.invoke('feedback:submit', rating, text),

  // Auto-update (manual flow: user clicks Download, then Restart & Install)
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },

  // Prompt paste (nut.js)
  agentPaste: (text: string) => ipcRenderer.invoke('agent:paste', text),
  agentActiveWindow: () => ipcRenderer.invoke('agent:active-window'),

  // Automation permission (macOS Accessibility)
  getPermissionStatus: () => ipcRenderer.invoke('permission:check'),
  openPermissionSettings: () => ipcRenderer.invoke('permission:open-settings'),
  restartApp: () => ipcRenderer.invoke('app:restart'),
});
