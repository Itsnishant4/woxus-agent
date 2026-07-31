import Store from 'electron-store';

export interface CachedLicense {
  valid: boolean;
  license_key: string;
  expires_at: string;
  hardware_id: string;
}

export interface CachedTrial {
  active: boolean;
  email: string;
  remaining_seconds: number;
  total_seconds: number;
}

const store = new Store({
  defaults: {
    launchAtLogin: false,
    globalHotkey: 'CommandOrControl+Shift+P',
    licenseKey: '',
    trialEmail: '',
    trialStartedAt: 0,
    cachedLicenseStatus: null as CachedLicense | null,
    cachedTrialStatus: null as CachedTrial | null,
  },
  schema: {
    launchAtLogin: { type: 'boolean', default: false },
    globalHotkey: { type: 'string', default: 'CommandOrControl+Shift+P' },
    licenseKey: { type: 'string', default: '' },
    trialEmail: { type: 'string', default: '' },
    trialStartedAt: { type: 'number', default: 0 },
    cachedLicenseStatus: { type: ['object', 'null'], default: null },
    cachedTrialStatus: { type: ['object', 'null'], default: null },
  },
});

export const settingsStore = {
  getLaunchAtLogin: (): boolean => store.get('launchAtLogin') as boolean,
  setLaunchAtLogin: (value: boolean): void => store.set('launchAtLogin', value),

  getGlobalHotkey: (): string => store.get('globalHotkey') as string,
  setGlobalHotkey: (value: string): void => store.set('globalHotkey', value),

  getLicenseKey: (): string => store.get('licenseKey') as string,
  setLicenseKey: (key: string): void => store.set('licenseKey', key),

  getTrialEmail: (): string => store.get('trialEmail') as string,
  setTrialEmail: (email: string): void => store.set('trialEmail', email),

  getTrialStartedAt: (): number => store.get('trialStartedAt') as number,
  setTrialStartedAt: (ts: number): void => store.set('trialStartedAt', ts),

  getCachedLicenseStatus: (): CachedLicense | null => store.get('cachedLicenseStatus') as CachedLicense | null,
  setCachedLicenseStatus: (status: CachedLicense | null): void => store.set('cachedLicenseStatus', status),

  getCachedTrialStatus: (): CachedTrial | null => store.get('cachedTrialStatus') as CachedTrial | null,
  setCachedTrialStatus: (status: CachedTrial | null): void => store.set('cachedTrialStatus', status),

  clear: (): void => {
    store.set('licenseKey', '');
    store.set('cachedLicenseStatus', null);
    store.set('cachedTrialStatus', null);
  },
};
