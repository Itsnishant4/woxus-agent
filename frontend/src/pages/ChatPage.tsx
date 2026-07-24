import { useEffect, useRef, useState } from 'react';
import ChatBubble from '@components/Chat/ChatBubble';
import ChatInput from '@components/Chat/ChatInput';
import VoiceButton from '@components/VoiceOrb/VoiceButton';
import { useVoiceStore } from '../store/voice';
import {
  startVoiceSession,
  stopVoiceSession,
  sendTextMessage,
} from '../services/voice';

export default function ChatPage() {
  const { connected, isListening, micActive, transcripts, addTranscript } =
    useVoiceStore();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-scroll on new transcripts
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const handleToggleListening = async () => {
    if (connected) {
      stopVoiceSession();
    } else {
      setError(null);
      try {
        await startVoiceSession((role, text) => {
          // Transcription callback — store updates handled by voice service
        });
      } catch (e: any) {
        setError(e.message || 'Could not start voice session');
        console.error(e);
      }
    }
  };

  const handleSend = (content: string) => {
    // Send text message directly via Gemini Live
    if (connected) {
      sendTextMessage(content);
    }
    // Show in chat
    addTranscript('user', content);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10">
        <div
          className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-400' : 'bg-gray-500'
          }`}
        />
        <span className="text-xs text-gray-400">
          {connected
            ? micActive
              ? 'Listening...'
              : 'Connected'
            : 'Disconnected'}
        </span>
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {transcripts.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">Click the mic to start talking to Woxus</p>
            <p className="text-sm mt-1">
              Or type a message below
            </p>
          </div>
        )}
        {transcripts.map((t, i) => (
          <ChatBubble key={i} role={t.role} content={t.text} />
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <div className="flex items-center gap-3 p-4 border-t border-white/10">
        <VoiceButton
          isListening={connected && micActive}
          onClick={handleToggleListening}
          disabled={false}
        />
        <ChatInput onSend={handleSend} disabled={!connected} />
      </div>
    </div>
  );
}
