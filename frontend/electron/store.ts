import Store from 'electron-store';

const store = new Store({
  defaults: {
    launchAtLogin: false,
  },
  schema: {
    launchAtLogin: { type: 'boolean', default: false },
  },
});

export const settingsStore = {
  getLaunchAtLogin: (): boolean => store.get('launchAtLogin') as boolean,
  setLaunchAtLogin: (value: boolean): void => store.set('launchAtLogin', value),
};
