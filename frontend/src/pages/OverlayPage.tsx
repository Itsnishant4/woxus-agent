import { useState, useRef, useEffect } from 'react';
import { Search, Loader2, Volume2 } from 'lucide-react';
import { useVoiceChat, toolWorkLabel } from '../hooks/useVoiceChat';

// Overlay popup: type text → Gemini main voice agent speaks the reply.
// Shares the useVoiceChat session logic with the permanent Chat screen.

export default function OverlayPage() {
  const [query, setQuery] = useState('');
  const { messages, connecting, connected, speaking, working, sendVoiceText } = useVoiceChat();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const submitQuery = async (text?: string) => {
    if (!text?.trim() || connecting) return;
    const trimmed = text.trim();
    setQuery('');
    await sendVoiceText(trimmed);
  };

  // Close overlay on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // @ts-ignore
        if (window.electronAPI?.hideOverlay) {
          // @ts-ignore
          window.electronAPI.hideOverlay();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setQuery('');
      } else {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the conversation scrolled to the newest message
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, speaking, working]);

  return (
    <div className="flex flex-col items-center justify-start pt-4 p-4 h-full bg-transparent overflow-hidden pointer-events-none">
      <div className="w-full max-w-2xl max-h-[520px] bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl overflow-hidden flex flex-col pointer-events-auto ring-1 ring-white/5">

        {/* Search Bar */}
        <div className="flex items-center gap-3 px-5 py-4 shrink-0">
          <Search className="h-5 w-5 text-violet-500/70 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitQuery(query);
            }}
            placeholder="Type a message, Woxus replies with voice..."
            className="flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          {speaking && !working && <Volume2 className="h-4 w-4 text-emerald-500 animate-pulse shrink-0" />}
          {working && <Loader2 className="h-4 w-4 text-violet-500 animate-spin shrink-0" />}
        </div>

        {/* Voice status */}
        <div className="flex items-center gap-2 px-5 pb-3 shrink-0">
          {connecting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Connecting voice agent...</span>
            </>
          ) : working ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              <span className="text-xs text-muted-foreground">{toolWorkLabel(working.name, working.label)}</span>
            </>
          ) : speaking ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              <span className="text-xs text-muted-foreground">Voice agent is speaking...</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {connected ? 'Voice agent ready — replies spoken aloud' : 'Press Enter — voice agent answers aloud'}
            </span>
          )}
        </div>

        {/* Conversation */}
        {messages.length !== 0 && (
          <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-4 min-h-0 border-t border-border/30">
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex items-center justify-end">
                  <div className="bg-muted/40 text-muted-foreground px-3 py-1.5 rounded-lg text-xs max-w-[85%] whitespace-pre-wrap border border-border/30 shadow-sm">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-3 text-foreground/90 leading-relaxed text-sm">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <span className="text-[10px] font-bold text-white">W</span>
                  </div>
                  <div className="flex-1 whitespace-pre-wrap">{m.content}</div>
                </div>
              )
            )}
            {working && (
              <div className="flex items-center gap-3 text-muted-foreground font-medium text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span>{toolWorkLabel(working.name, working.label)}</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
