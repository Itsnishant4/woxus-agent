import Store from 'electron-store';

const store = new Store({
  defaults: {
    launchAtLogin: false,
    globalHotkey: 'CommandOrControl+Shift+P',
  },
  schema: {
    launchAtLogin: { type: 'boolean', default: false },
    globalHotkey: { type: 'string', default: 'CommandOrControl+Shift+P' },
  },
});

export const settingsStore = {
  getLaunchAtLogin: (): boolean => store.get('launchAtLogin') as boolean,
  setLaunchAtLogin: (value: boolean): void => store.set('launchAtLogin', value),
  getGlobalHotkey: (): string => store.get('globalHotkey') as string,
  setGlobalHotkey: (value: string): void => store.set('globalHotkey', value),
};
