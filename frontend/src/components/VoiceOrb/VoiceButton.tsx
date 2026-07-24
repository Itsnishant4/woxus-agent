import { Mic, MicOff } from 'lucide-react';

interface VoiceButtonProps {
  isListening: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export default function VoiceButton({
  isListening,
  onClick,
  disabled,
}: VoiceButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
        isListening
          ? 'voice-orb bg-primary/30'
          : 'bg-white/10 hover:bg-white/20'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      title={isListening ? 'Stop session' : 'Start voice session'}
    >
      {isListening ? (
        <Mic size={20} className="text-primary" />
      ) : (
        <MicOff size={20} className="text-gray-400" />
      )}
    </button>
  );
}
