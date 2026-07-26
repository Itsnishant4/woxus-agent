import { useEffect, useRef, useState, useCallback } from 'react';
import { useVoiceStore } from '../store/voice';
import { startVoiceSession, stopVoiceSession } from '../services/voice';
import ChatBubble from '@components/Chat/ChatBubble';
import { PanelRightClose, PanelRightOpen, Volume2, Brain } from 'lucide-react';

export default function HomePage() {
  const { connected, isListening, transcripts, addTranscript } = useVoiceStore();
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const hasChat = transcripts.length > 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, isAiSpeaking]);

  useEffect(() => {
    if (hasChat && !chatOpen) setChatOpen(true);
  }, [hasChat]);

  // Open chat panel when voice session is active
  useEffect(() => {
    if ((connected || isListening) && !chatOpen && !hasChat) {
      setChatOpen(true);
    }
  }, [connected, isListening]);

  // Browser Speech Recognition for user speech
  const initSpeechRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (event.results[0].isFinal && transcript.trim()) {
        addTranscript('user', transcript.trim());
      }
    };

    rec.onerror = () => {};
    rec.onend = () => {
      if (connected || isListening) {
        try { rec.start(); } catch (_) {}
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch (_) {}
  }, [connected, isListening]);

  // Monitor gemini transcripts to detect speaking
  useEffect(() => {
    if (transcripts.length > 0) {
      const last = transcripts[transcripts.length - 1];
      if (last.role === 'gemini') {
        setIsAiSpeaking(true);
        const timer = setTimeout(() => setIsAiSpeaking(false), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [transcripts]);

  useEffect(() => {
    if (connected || isListening) {
      initSpeechRecognition();
    } else {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
        recognitionRef.current = null;
      }
    }
  }, [connected, isListening, initSpeechRecognition]);

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
              {isAiSpeaking ? 'Woxus is speaking...' : active ? 'Listening...' : 'Woxus Agent'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {active ? (isAiSpeaking ? '' : 'Speak now') : error || 'Click the orb to start'}
            </p>
          </div>
        </div>

        {/* Toggle button */}
        {(hasChat || active) && (
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
              {isAiSpeaking && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground animate-pulse">
                  <Brain className="w-4 h-4 mt-0.5" />
                  <span>Woxus is speaking...</span>
                </div>
              )}
              {active && transcripts.length === 0 && !isAiSpeaking && (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Speak now. Your speech will appear here.
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
