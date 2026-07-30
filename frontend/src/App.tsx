import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  Settings, Brain, Key,
  PanelLeft, Zap, ListChecks, Keyboard, Mic,
} from 'lucide-react';
import { Button, Separator } from '@heroui/react';
import HomePage from '@pages/HomePage';
import SettingsPage from '@pages/SettingsPage';
import MemoryPage from '@pages/MemoryPage';
import TasksPage from '@pages/TasksPage';
import LicensePage from '@pages/LicensePage';
import Toaster from '@components/Toast';
import { useTheme } from '@/hooks/useTheme';

type AppStatus = 'loading' | 'unlicensed' | 'trial' | 'licensed';

const navItems = [
  { to: '/', icon: Zap, label: 'Home' },
  { to: '/tasks', icon: ListChecks, label: 'Tasks' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/license', icon: Key, label: 'License' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

type AgentStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

const statusConfig: Record<AgentStatus, { color: string; label: string }> = {
  idle: { color: 'bg-muted-foreground', label: 'Idle' },
  listening: { color: 'bg-green-500', label: 'Listening' },
  thinking: { color: 'bg-amber-500', label: 'Thinking' },
  speaking: { color: 'bg-blue-500', label: 'Speaking' },
};

function CmdPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = query.trim()
    ? navItems.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
    : navItems;

  const allActions = [
    ...filtered.map((n) => ({ ...n, group: 'Navigation' as const })),
    { to: '', icon: Mic, label: 'Start voice session', group: 'Actions' as const },
  ].filter((a) =>
    query.trim() ? a.label.toLowerCase().includes(query.toLowerCase()) : true
  );

  const handleSelect = (path: string) => {
    onOpenChange(false);
    if (path) navigate(path);
  };

  return open ? (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onOpenChange(false);
              if (e.key === 'Enter' && allActions.length > 0) handleSelect(allActions[0].to);
            }}
            placeholder="Search actions..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {allActions.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-6">No results.</p>
          )}
          {['Navigation', 'Actions'].map((group) => {
            const items = allActions.filter((a) => a.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="text-[11px] text-muted-foreground/60 font-medium px-2 py-1.5 uppercase tracking-wider">{group}</p>
                {items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => handleSelect(item.to)}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-foreground hover:bg-accent transition-colors text-left"
                  >
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;
}

export default function App() {
  useTheme();
  const [appStatus, setAppStatus] = useState<AppStatus>('loading');
  const [collapsed, setCollapsed] = useState(false);
  const [agentStatus] = useState<AgentStatus>('idle');
  const [cmdOpen, setCmdOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const checkLicense = useCallback(async () => {
    // @ts-ignore
    const result = await window.electronAPI?.getLicenseStatus?.();
    if (!result) { setAppStatus('unlicensed'); return; }

    if (result.status === 'licensed') {
      setAppStatus('licensed');
      return;
    }

    if (result.status === 'trial') {
      setAppStatus('trial');
      return;
    }

    setAppStatus('unlicensed');
  }, []);

  useEffect(() => {
    checkLicense();
  }, [checkLicense]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const s = statusConfig[agentStatus];

  if (appStatus === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <span className="text-lg font-bold text-white">W</span>
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Checking license...</p>
        </div>
      </div>
    );
  }

  if (appStatus === 'unlicensed') {
    return (
      <div className="flex h-screen bg-background">
        <main className="flex-1 overflow-y-auto">
          <LicensePage onActivated={checkLicense} />
        </main>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground selection:bg-primary/10">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-border bg-sidebar transition-all duration-300 ease-out ${
          collapsed ? 'w-[52px]' : 'w-56'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 h-14 px-3">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <span className="text-xs font-bold text-white">W</span>
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${s.color}`} />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold tracking-tight truncate">Woxus</span>
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <div key={to} className="group relative">
              <button
                onClick={() => navigate(to)}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 ${
                  location.pathname === to
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </button>
              {collapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-md bg-popover text-popover-foreground text-xs shadow-lg border border-border whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
                  {label}
                </div>
              )}
            </div>
          ))}
        </nav>

        <Separator />

        {/* Bottom */}
        <div className="p-2 flex flex-col gap-1">
          <div className="group relative">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-3 px-2.5 text-muted-foreground hover:text-foreground"
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeft className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="text-sm">Collapse</span>}
            </Button>
            {collapsed && (
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-md bg-popover text-popover-foreground text-xs shadow-lg border border-border whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
                Expand
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm">
          <h1 className="text-sm font-medium text-foreground">
            {navItems.find((n) => n.to === location.pathname)?.label || 'Woxus'}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCmdOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-border/60 transition-all"
            >
              <Keyboard className="h-3.5 w-3.5" />
              <span className="hidden sm:inline font-medium">
                {navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl+K'}
              </span>
            </button>
          </div>
        </header>

        {/* Pages */}
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/license" element={<LicensePage onActivated={checkLicense} />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </div>
      </main>

      {/* Command Palette */}
      <CmdPalette open={cmdOpen} onOpenChange={setCmdOpen} />
      <Toaster />
    </div>
  );
}
