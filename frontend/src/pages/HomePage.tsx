import { useState, useEffect } from 'react';
import { useVoiceStore } from '../store/voice';
import { startVoiceSession, stopVoiceSession } from '../services/voice';
import { Loader2, Terminal } from 'lucide-react';
import ModelDownloadBanner from '../components/ModelDownloadBanner';

interface Task {
  task_id: string;
  command: string;
  state: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  elapsed_seconds: number;
}

const API = '/api';

export default function HomePage() {
  const { connected, isListening, sttStatus } = useVoiceStore();
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const pollTasks = async () => {
      try {
        const res = await window.fetch(`${API}/tasks/`);
        const data = await res.json();
        setTasks((data.tasks || []).filter((t: Task) => t.state === 'running'));
      } catch { /* ignore */ }
    };
    pollTasks();
    const interval = setInterval(pollTasks, 2000);
    return () => clearInterval(interval);
  }, []);

  const active = connected || isListening;

  const handleVoice = async () => {
    if (connected) {
      stopVoiceSession();
    } else {
      setError(null);
      try {
        await startVoiceSession();
      } catch (e: any) {
        setError(e.message || 'Could not start voice session');
      }
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ModelDownloadBanner />
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <button
            onClick={handleVoice}
            className="relative focus:outline-none"
          >
            <div
              className={`w-32 h-32 rounded-full transition-all duration-700 flex items-center justify-center ${
                active
                  ? 'bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25 cursor-pointer'
                  : 'bg-gradient-to-br from-violet-500/20 to-indigo-600/20 ring-1 ring-violet-500/10 hover:ring-violet-500/30 cursor-pointer'
              }`}
            >
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 ${
                  active ? 'bg-white/20' : 'bg-muted'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full transition-all duration-500 ${
                    active ? 'bg-white' : 'bg-muted-foreground/30'
                  }`}
                />
              </div>
            </div>
            {active && (
              <>
                <span className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />
                <span className="absolute inset-[-8px] rounded-full bg-violet-500/10 animate-ping [animation-delay:0.2s]" />
                <span className="absolute inset-[-16px] rounded-full bg-violet-500/5 animate-ping [animation-delay:0.4s]" />
              </>
            )}
          </button>

          <div className="text-center space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {active ? 'Listening...' : 'Woxus Agent'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {active ? 'Speak now' : error || 'Click the orb to start'}
            </p>
          </div>

          {sttStatus === 'downloading' && (
            <div className="flex flex-col items-center gap-2 animate-in slide-in-from-top-2 fade-in duration-300">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-accent/50 border border-border/60">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" />
                <span className="text-xs text-foreground/80">Downloading speech model (~75 MB, once)…</span>
              </div>
              <div className="w-56 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 animate-pulse w-full" />
              </div>
            </div>
          )}
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="relative px-6 pb-4">
          <div className="absolute inset-x-6 bottom-0 h-20 pointer-events-none bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div className="relative max-h-32 overflow-y-auto scrollbar-thin">
            <div className="space-y-1.5 pt-2">
              {tasks.map((t) => (
                <div
                  key={t.task_id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/50 border border-border/60 text-xs"
                >
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-500" />
                  <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-foreground/80">{t.command}</span>
                  <span className="shrink-0 text-muted-foreground">{t.elapsed_seconds.toFixed(0)}s</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
