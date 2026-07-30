import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.invoke('set-auto-launch', enable),
  platform: process.platform,

  // License IPC
  getHardwareId: () => ipcRenderer.invoke('hardware:get-id'),
  verifyLicense: (licenseKey: string) => ipcRenderer.invoke('license:verify', licenseKey),
  getLicenseStatus: () => ipcRenderer.invoke('license:get-status'),
  getTrialStatus: () => ipcRenderer.invoke('trial:status'),
  startTrial: (email: string) => ipcRenderer.invoke('trial:start', email),
  submitFeedback: (rating: number, text: string) => ipcRenderer.invoke('feedback:submit', rating, text),
});
