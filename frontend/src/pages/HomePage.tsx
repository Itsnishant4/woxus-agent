import { useState } from 'react';
import { useVoiceStore } from '../store/voice';
import { startVoiceSession, stopVoiceSession } from '../services/voice';

export default function HomePage() {
  const { connected, isListening } = useVoiceStore();
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex h-full items-center justify-center">
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
    </div>
  );
}
