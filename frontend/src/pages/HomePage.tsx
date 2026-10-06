import { useState, useEffect, useRef } from 'react';
import { useVoiceStore } from '../store/voice';
import { startVoiceSession, stopVoiceSession } from '../services/voice';
import { Loader2, Terminal, Send, Volume2 } from 'lucide-react';
import ModelDownloadBanner from '../components/ModelDownloadBanner';
import { API_BASE } from '../services/api';
import { useVoiceChat, toolWorkLabel } from '../hooks/useVoiceChat';

interface Task {
  task_id: string;
  command: string;
  state: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  elapsed_seconds: number;
}

const API = API_BASE;

export default function HomePage() {
  const { connected, isListening, sttStatus } = useVoiceStore();
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const { messages, connecting, connected: voiceConnected, speaking, working, sendVoiceText } = useVoiceChat();
  const chatListRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, speaking, connecting, working]);

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

  const sendChat = async () => {
    const trimmed = chatText.trim();
    if (!trimmed || connecting || chatSending) return;
    setChatText('');
    setChatSending(true);
    try {
      await sendVoiceText(trimmed);
    } finally {
      setChatSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ModelDownloadBanner />
      <div className="flex-1 flex flex-row min-h-0">
        {/* Orb */}
        <div className="flex-1 flex items-center justify-center min-w-0">
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

        {/* Chat panel (voice agent: replies spoken aloud + shown here) */}
        <div className="w-[340px] shrink-0 border-l border-border flex flex-col min-h-0 bg-background/60">
          <div className="px-4 py-3 border-b border-border shrink-0 flex items-center gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Chat</p>
              <p className="text-[11px] text-muted-foreground">
                {connecting ? 'Connecting voice agent...' : working ? toolWorkLabel(working.name, working.label) : speaking ? 'Voice agent is speaking...' : voiceConnected ? 'Replies spoken aloud' : 'Type — voice agent answers aloud'}
              </p>
            </div>
            {(speaking || working) && !connecting && (
              working
                ? <Loader2 className="h-4 w-4 text-violet-500 animate-spin shrink-0" />
                : <Volume2 className="h-4 w-4 text-emerald-500 animate-pulse shrink-0" />
            )}
          </div>
          <div ref={chatListRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground/60 text-center pt-6">
                Type below — the voice agent speaks its reply and shows it here.
              </p>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground px-3 py-1.5 rounded-2xl rounded-tr-sm text-xs max-w-[90%] whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-bold text-white">W</span>
                  </div>
                  <div className="flex-1 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap bg-muted/40 rounded-2xl rounded-tl-sm px-3 py-1.5">
                    {m.content}
                  </div>
                </div>
              )
            )}
            {connecting && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                <span>Connecting voice agent...</span>
              </div>
            )}
            {working && !connecting && (
              <div className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Loader2 className="h-3 w-3 animate-spin text-white" />
                </div>
                <div className="flex-1 text-xs leading-relaxed text-foreground/80 bg-muted/40 rounded-2xl rounded-tl-sm px-3 py-1.5">
                  {toolWorkLabel(working.name, working.label)}
                </div>
              </div>
            )}
          </div>
          <div className="p-3 border-t border-border shrink-0">
            <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring transition-shadow">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Type a message, voice replies..."
                disabled={connecting || chatSending}
                className="flex-1 bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground disabled:opacity-50"
              />
              <button
                onClick={sendChat}
                disabled={connecting || chatSending || !chatText.trim()}
                className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
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
