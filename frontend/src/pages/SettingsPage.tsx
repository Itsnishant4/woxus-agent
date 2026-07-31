import { useEffect, useState } from 'react';
import { Card, CardContent, Switch, Separator } from '@heroui/react';
import { Palette, Bell, Shield, Info, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

function AppearanceSection() {
  const { dark, toggle } = useTheme();
  return (
    <div className="flex items-center justify-between">
      <div>
        <label htmlFor="dark-mode" className="text-sm font-medium text-foreground">Dark mode</label>
        <p className="text-xs text-muted-foreground">Toggle between light and dark theme</p>
      </div>
      <Switch isSelected={dark} onChange={toggle}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}

function SystemSection() {
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [hotkey, setHotkey] = useState('CommandOrControl+Shift+P');

  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.getAutoLaunch) {
      // @ts-ignore
      window.electronAPI.getAutoLaunch().then(setAutoLaunch);
    }
    // @ts-ignore
    if (window.electronAPI?.getGlobalHotkey) {
      // @ts-ignore
      window.electronAPI.getGlobalHotkey().then((h: string) => {
        if (h) setHotkey(h);
      });
    }
  }, []);

  const toggleAutoLaunch = async () => {
    const next = !autoLaunch;
    setAutoLaunch(next);
    // @ts-ignore
    if (window.electronAPI?.setAutoLaunch) {
      // @ts-ignore
      await window.electronAPI.setAutoLaunch(next);
    }
  };

  const saveHotkey = async () => {
    // @ts-ignore
    if (window.electronAPI?.setGlobalHotkey) {
      // @ts-ignore
      await window.electronAPI.setGlobalHotkey(hotkey);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <label htmlFor="auto-launch" className="text-sm font-medium text-foreground">Launch on startup</label>
          <p className="text-xs text-muted-foreground">Auto-start Woxus when you log in</p>
        </div>
        <Switch isSelected={autoLaunch} onChange={toggleAutoLaunch}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>

      <Separator />

      <div className="space-y-3">
        <div>
          <label htmlFor="global-hotkey" className="text-sm font-medium text-foreground">Global Hotkey</label>
          <p className="text-xs text-muted-foreground">Shortcut to toggle the Woxus overlay (e.g. CommandOrControl+Shift+P)</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            id="global-hotkey"
            value={hotkey}
            onChange={(e) => setHotkey(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            onClick={saveHotkey}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ApiKeySection() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.getApiKey) {
      // @ts-ignore
      window.electronAPI.getApiKey().then((k: string) => setApiKey(k || ''));
    }
    // @ts-ignore
    if (window.electronAPI?.getGeminiModel) {
      // @ts-ignore
      window.electronAPI.getGeminiModel().then((m: string) => setModel(m || ''));
    }
  }, []);

  const save = async () => {
    // @ts-ignore
    if (window.electronAPI?.setApiKey) {
      // @ts-ignore
      await window.electronAPI.setApiKey(apiKey.trim());
    }
    // @ts-ignore
    if (window.electronAPI?.setGeminiModel) {
      // @ts-ignore
      await window.electronAPI.setGeminiModel(model.trim());
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="api-key" className="text-sm font-medium text-foreground">Gemini API Key</label>
        <p className="text-xs text-muted-foreground">Required for AI features in the packaged app (no .env)</p>
      </div>
      <input
        type="password"
        id="api-key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="AIza..."
        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
      <div>
        <label htmlFor="gemini-model" className="text-sm font-medium text-foreground">Model</label>
        <p className="text-xs text-muted-foreground">Comma-separated list (leave empty for default)</p>
      </div>
      <input
        type="text"
        id="gemini-model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="gemini-2.5-flash-native-audio-preview-12-2025,gemini-2.0-flash-live-preview"
        className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-all"
        >
          Save
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}

const sections = [
  {
    id: 'system',
    title: 'System',
    description: 'System-level integration settings',
    icon: Monitor,
    content: <SystemSection />,
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Customize how Woxus looks',
    icon: Palette,
    content: <AppearanceSection />,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Control what Woxus notifies you about',
    icon: Bell,
    content: (
      <div className="flex items-center justify-between">
        <div>
          <label htmlFor="notif" className="text-sm font-medium text-foreground">Enable notifications</label>
          <p className="text-xs text-muted-foreground">Receive alerts from Woxus</p>
        </div>
        <Switch>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy & Security',
    description: 'Manage your data and permissions',
    icon: Shield,
    content: <ApiKeySection />,
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version and information',
    icon: Info,
    content: (
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Woxus v0.1.0</p>
        <p>Built with love 🧡 Team Woxus 🇮🇳</p>
      </div>
    ),
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-8 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your Woxus agent</p>
      </div>
      <Separator />
      <div className="space-y-4">
        {sections.map(({ id, title, description, icon: Icon, content }) => (
          <Card key={id} className="border-border/60 shadow-sm">
            <div className="px-6 pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                  <Icon className="h-4 w-4 text-accent-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-xs text-foreground/60">{description}</p>
                </div>
              </div>
            </div>
            <CardContent>{content}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
