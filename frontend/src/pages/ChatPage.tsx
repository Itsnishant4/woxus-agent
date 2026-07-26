import { useEffect, useRef, useState } from 'react';
import ChatBubble from '@components/Chat/ChatBubble';
import ChatInput from '@components/Chat/ChatInput';
import { useVoiceStore } from '../store/voice';
import {
  startVoiceSession,
  stopVoiceSession,
  sendTextMessage,
} from '../services/voice';
import { Button } from '@heroui/react';
import { Mic, Square, Sparkles } from 'lucide-react';

export default function ChatPage() {
  const { connected, transcripts, addTranscript } = useVoiceStore();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const handleToggleListening = async () => {
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

  const handleSend = (content: string) => {
    if (connected) sendTextMessage(content);
    addTranscript('user', content);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {transcripts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-220px)] text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center mb-5 ring-1 ring-violet-500/10">
                <Sparkles className="h-6 w-6 text-violet-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">How can I help you?</h2>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">
                Start a voice conversation or type a message below.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {transcripts.map((t, i) => (
                <ChatBubble key={i} role={t.role} content={t.text} />
              ))}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      <div className="border-t border-border px-6 py-4 bg-gradient-to-t from-background via-background to-transparent">
        <div className="max-w-2xl mx-auto flex items-end gap-3">
          <Button
            variant={connected ? 'primary' : 'outline'}
            isIconOnly
            className={`rounded-full shrink-0 transition-all ${
              connected
                ? 'bg-green-600 text-white shadow-sm shadow-green-600/20'
                : ''
            }`}
            onClick={handleToggleListening}
          >
            {connected ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <ChatInput onSend={handleSend} disabled={!connected} />
          {error && (
            <p className="text-xs text-destructive whitespace-nowrap shrink-0">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
