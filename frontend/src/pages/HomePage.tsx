import { useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '../store/voice';
import { startVoiceSession, stopVoiceSession } from '../services/voice';
import ChatBubble from '@components/Chat/ChatBubble';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

export default function HomePage() {
  const { connected, isListening, transcripts } = useVoiceStore();
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const hasChat = transcripts.length > 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  useEffect(() => {
    if (hasChat && !chatOpen) setChatOpen(true);
  }, [hasChat]);

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
    <div className="flex h-full">
      {/* Left: Orb */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative">
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
        </div>

        {/* Toggle button */}
        {hasChat && (
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className="absolute top-4 right-4 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {chatOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Right: Chat panel */}
      <div
        className={`border-l border-border/40 flex flex-col overflow-hidden transition-all duration-300 ease-out ${
          chatOpen ? 'w-90 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <div className="relative flex-1 min-w-0 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />

          <div className="h-full overflow-y-auto px-4 py-8 scroll-smooth">
            <div className="space-y-4">
              {transcripts.map((t, i) => (
                <ChatBubble key={i} role={t.role} content={t.text} />
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
