import { useEffect, useState } from 'react';
import { Card, CardContent, Switch, Separator } from '@heroui/react';
import { Key, Palette, Bell, Shield, Info, Monitor } from 'lucide-react';
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

  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI && window.electronAPI.getAutoLaunch) {
      // @ts-ignore
      window.electronAPI.getAutoLaunch().then(setAutoLaunch);
    }
  }, []);

  const toggleAutoLaunch = async () => {
    const newVal = !autoLaunch;
    setAutoLaunch(newVal);
    // @ts-ignore
    if (window.electronAPI && window.electronAPI.setAutoLaunch) {
      // @ts-ignore
      await window.electronAPI.setAutoLaunch(newVal);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <label htmlFor="auto-launch" className="text-sm font-medium text-foreground">Launch on startup</label>
        <p className="text-xs text-muted-foreground">Automatically start Woxus when you log in</p>
      </div>
      <Switch isSelected={autoLaunch} onChange={toggleAutoLaunch}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}

const sections = [
  {
    id: 'api-keys',
    title: 'API Keys',
    description: 'Configure your Gemini API key for AI features',
    icon: Key,
    content: <p className="text-sm text-muted-foreground">No API keys configured yet.</p>,
  },
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
