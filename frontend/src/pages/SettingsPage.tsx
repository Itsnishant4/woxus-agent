import { useEffect, useState } from 'react';
import { Card, CardContent, Switch, Separator } from '@heroui/react';
import { Palette, Bell, Shield, Info, Monitor, Download, Loader2, CheckCircle2, XCircle, MessageCircle } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { resolveBackendPort } from '../services/api';

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
  const [starting, setStarting] = useState(false);

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
        if (
          state.status === 'available' ||
          state.status === 'idle' ||
          state.status === 'none' ||
          state.status === 'downloaded' ||
          state.status === 'mac-dmg-ready'
        ) {
          setStarting(false);
        }
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
          {status === 'checking' && <Loader2 className="h-4 w-4 animate-spin" />}
          {status === 'checking' ? 'Checking…' : 'Check for Updates'}
        </button>
      </div>

      {status === 'available' && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-violet-600">Update v{newVersion} available</p>
          <button
            onClick={() => { setStarting(true); api?.downloadUpdate(newVersion); }}
            disabled={starting}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-all flex items-center gap-2 disabled:opacity-60"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {starting ? 'Downloading…' : 'Download'}
          </button>
        </div>
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

      {status === 'mac-dmg-ready' && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-1.5">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> v{newVersion} downloaded — installer opened
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <b>Quit Woxus</b>, then in the installer window drag <b>Woxus.app</b> onto the{' '}
            <b>Applications</b> folder and click <b>Replace</b>. Then relaunch Woxus.
          </p>
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

function WhatsAppSection() {
  const API = `http://127.0.0.1:${resolveBackendPort()}/api`;
  const [status, setStatus] = useState<any>(null);
  const [qr, setQr] = useState<any>({ status: 'idle', qr_text: '' });
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [defaultCc, setDefaultCc] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [QRComp, setQRComp] = useState<any>(null);

  useEffect(() => {
    import('qrcode.react').then((m: any) => setQRComp(() => m.QRCodeSVG || m.default)).catch(() => {});
  }, []);

  const authHeaders = async () => {
    const licenseKey = localStorage.getItem('woxus_license_key') || '';
    // @ts-ignore
    const hwid = await (window as any).electronAPI?.getHardwareId?.() || 'unknown';
    return { 'Content-Type': 'application/json', 'X-License-Key': licenseKey, 'X-Hardware-Id': hwid };
  };

  const load = async () => {
    try {
      const h = await authHeaders();
      const [s, c] = await Promise.all([
        fetch(`${API}/whatsapp/status`, { headers: h }).then((r) => r.json()),
        fetch(`${API}/whatsapp/contacts`, { headers: h }).then((r) => r.json()),
      ]);
      setStatus(s);
      setContacts(c.contacts || {});
      setDefaultCc(c.default_country || '');
    } catch (e: any) {
      setNote(e.message || 'load failed');
    }
  };

  useEffect(() => { load(); }, []);

  const startPair = async () => {
    setBusy(true); setNote('');
    try {
      const h = await authHeaders();
      await fetch(`${API}/whatsapp/pair/start`, { method: 'POST', headers: h });
      const poll = setInterval(async () => {
        const hh = await authHeaders();
        const q = await fetch(`${API}/whatsapp/pair/qr`, { headers: hh }).then((r) => r.json());
        setQr(q);
        if (q.status === 'paired' || q.paired) {
          clearInterval(poll); setBusy(false);
          setNote('WhatsApp linked. Syncing contacts…');
          load();
        }
        if (q.status === 'error' || q.status === 'expired') {
          clearInterval(poll); setBusy(false);
          setNote(q.error || 'QR expired. Try Pair again.');
        }
      }, 2000);
      setTimeout(() => { clearInterval(poll); setBusy(false); }, 180000);
    } catch (e: any) { setBusy(false); setNote(e.message); }
  };

  const saveContacts = async () => {
    try {
      const h = await authHeaders();
      await fetch(`${API}/whatsapp/contacts`, { method: 'PUT', headers: h, body: JSON.stringify({ whatsapp_contacts: contacts, whatsapp_default_country: defaultCc }) });
      setNote('Contacts saved. Voice NLP uses nearest-name scores.');
    } catch (e: any) { setNote(e.message); }
  };

  const addContact = () => {
    if (!name.trim() || !phone.trim()) return;
    setContacts((c) => ({ ...c, [name.trim().toLowerCase()]: phone.trim() }));
    setName(''); setPhone('');
  };

  const testSend = async (confirm: boolean) => {
    try {
      const h = await authHeaders();
      const r = await fetch(`${API}/whatsapp/send`, { method: 'POST', headers: h, body: JSON.stringify({ to: testTo, message: testMsg, confirm }) }).then((r) => r.json());
      setNote(JSON.stringify(r).slice(0, 400));
    } catch (e: any) { setNote(e.message); }
  };

  const qrText = qr?.qr_text || '';
  const showQR = qrText && qrText.length > 10;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Status: {status ? `${status.status} ${status.paired ? '✓' : ''}` : '…'}</p>
          <p className="text-xs text-muted-foreground">{status?.hint || 'wacli linked-device. Voice: send WhatsApp to <name> <text>.'}</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-accent text-xs font-medium">Refresh</button>
      </div>
      <div className="flex gap-2">
        <button onClick={startPair} disabled={busy} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium disabled:opacity-50">
          {busy ? 'Waiting for scan…' : 'Pair / Show QR'}
        </button>
        <button onClick={async () => { const h = await authHeaders(); await fetch(`${API}/whatsapp/logout`, { method: 'POST', headers: h }); load(); }} className="px-4 py-2 rounded-lg bg-accent text-sm">Logout</button>
      </div>
      {showQR && (
        <div className="rounded-lg border border-border p-4 space-y-2">
          <p className="text-xs font-medium">Scan in WhatsApp → Linked devices → Link a device</p>
          {QRComp && qrText.length < 1000 ? <QRComp value={qrText} size={220} /> : (
            <pre className="text-[10px] whitespace-pre-wrap break-all bg-background border border-border rounded p-2 max-h-40 overflow-auto">{qrText}</pre>
          )}
          <p className="text-[11px] text-muted-foreground">QR from terminal (wacli auth --qr-format text). Expires fast. If it fails, Pair again.</p>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Named contacts (NLP nearest-match)</p>
        {Object.entries(contacts).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{k} → {v}</span>
            <button onClick={() => setContacts((c) => { const n = { ...c }; delete n[k]; return n; })} className="text-xs text-red-500">remove</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name e.g. mom" className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
          <button onClick={addContact} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm">Add</button>
        </div>
        <div className="flex gap-2 items-center">
          <input value={defaultCc} onChange={(e) => setDefaultCc(e.target.value)} placeholder="default country +91" className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
          <button onClick={saveContacts} className="px-3 py-2 rounded-lg bg-accent text-sm">Save</button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Test send (confirm gate)</p>
        <div className="flex gap-2">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="mom or +91..." className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
          <input value={testMsg} onChange={(e) => setTestMsg(e.target.value)} placeholder="hello" className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => testSend(false)} className="px-3 py-2 rounded-lg bg-accent text-sm">Preview (score)</button>
          <button onClick={() => testSend(true)} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm">Send (confirm=true)</button>
        </div>
      </div>
      {note && <p className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{note}</p>}
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
    id: 'whatsapp',
    title: 'WhatsApp',
    description: 'Pair wacli, QR login, NLP contacts',
    icon: MessageCircle,
    content: <WhatsAppSection />,
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
