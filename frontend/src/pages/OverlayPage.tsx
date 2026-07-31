import { useState, useRef, useEffect } from 'react';
import { Search, Loader2 } from 'lucide-react';
const API = 'http://127.0.0.1:8000/api';

// Stable per-overlay-session id so the backend keeps conversation context
const CONVERSATION_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `overlay-${Date.now()}`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function OverlayPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadHistory = async () => {
    try {
      const res = await fetch(`${API}/overlay/history?conversation_id=${CONVERSATION_ID}`);
      const data = await res.json();
      const history: ChatMessage[] = (data.history || []).filter(
        (m: ChatMessage) => m.role === 'user' || m.role === 'assistant'
      );
      setMessages(history);
    } catch {
      /* ignore */
    }
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
        setLoading(false);
      } else {
        loadHistory();
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
    loadHistory();
    inputRef.current?.focus();
  }, []);

  // Keep the conversation scrolled to the newest message
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const submitQuery = async (text?: string) => {
    if (!text?.trim()) return;

    const trimmed = text.trim();
    setQuery('');
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    try {
      const licenseKey = localStorage.getItem('woxus_license_key') || '';
      const hwid = await (window as any).electronAPI?.getHardwareId?.() || 'unknown';

      const res = await fetch(`${API}/overlay/clarify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-License-Key': licenseKey,
          'X-Hardware-Id': hwid,
        },
        body: JSON.stringify({ content: trimmed, conversation_id: CONVERSATION_ID }),
      });
      const data = await res.json();
      const reply = res.ok
        ? data.clarification
        : data.detail || data.error || 'Failed to get a response.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Failed to get a response.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

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
            placeholder="Ask Woxus anything..."
            className="flex-1 bg-transparent text-lg text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
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
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <span className="text-[10px] font-bold text-white">W</span>
                  </div>
                  <div className="flex-1 whitespace-pre-wrap">{m.content}</div>
                </div>
              )
            )}

            {loading && (
              <div className="flex items-center gap-3 text-muted-foreground font-medium text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <span>Woxus is thinking...</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
