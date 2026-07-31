import { useEffect, useState } from 'react';
import { Card, CardContent, Switch, Separator } from '@heroui/react';
import { Palette, Bell, Shield, Info, Monitor, Download, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
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

function UpdateSection() {
  const [status, setStatus] = useState<string>('idle');
  const [percent, setPercent] = useState(0);
  const [version, setVersion] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.getAppVersion) {
      // @ts-ignore
      window.electronAPI.getAppVersion().then(setVersion);
    }
    // @ts-ignore
    if (window.electronAPI?.onUpdateStatus) {
      // @ts-ignore
      const unsubscribe = window.electronAPI.onUpdateStatus((state: any) => {
        setStatus(state.status);
        if (state.percent != null) setPercent(state.percent);
        if (state.version) setNewVersion(state.version);
        if (state.error) setError(state.error);
      });
      return unsubscribe;
    }
  }, []);

  // @ts-ignore
  const api = window.electronAPI;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-foreground">Woxus {version}</label>
          <p className="text-xs text-muted-foreground">Check for new versions automatically</p>
        </div>
        <button
          onClick={() => api?.checkForUpdates()}
          disabled={status === 'checking' || status === 'downloading'}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${status === 'checking' ? 'animate-spin' : ''}`} />
          Check for Updates
        </button>
      </div>

      {status === 'available' && (
        <p className="text-sm text-violet-600">Update v{newVersion} found — downloading…</p>
      )}

      {status === 'downloading' && (
        <div className="space-y-1.5">
          <p className="text-sm text-violet-600">Downloading v{newVersion}… {percent}%</p>
          <div className="w-full h-2 rounded-full bg-accent overflow-hidden">
            <div className="h-full bg-violet-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {status === 'downloaded' && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Update v{newVersion} ready
          </p>
          <button
            onClick={() => api?.installUpdate()}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-all flex items-center gap-2"
          >
            <Download className="h-4 w-4" /> Restart &amp; Update
          </button>
        </div>
      )}

      {status === 'none' && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> You&apos;re up to date
        </p>
      )}

      {status === 'error' && (
        <p className="text-sm text-red-500 flex items-center gap-1.5">
          <XCircle className="h-4 w-4" /> Update check failed: {error}
        </p>
      )}
    </div>
  );
}

function AboutSection() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.getAppVersion) {
      // @ts-ignore
      window.electronAPI.getAppVersion().then(setVersion);
    }
  }, []);
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>Woxus v{version}</p>
      <p>Built with love 🧡 Team Woxus 🇮🇳</p>
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
    content: <p className="text-sm text-muted-foreground">All data stored locally. No data shared without your consent.</p>,
  },
  {
    id: 'updates',
    title: 'Updates',
    description: 'Keep Woxus up to date',
    icon: Download,
    content: <UpdateSection />,
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version and information',
    icon: Info,
    content: <AboutSection />,
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
