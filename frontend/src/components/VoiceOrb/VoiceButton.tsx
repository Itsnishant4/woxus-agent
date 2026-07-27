import { Mic, MicOff } from 'lucide-react';
import { Button } from '@heroui/react';

interface VoiceButtonProps {
  isListening: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export default function VoiceButton({ isListening, onClick, disabled }: VoiceButtonProps) {
  return (
    <Button
      variant={isListening ? 'primary' : 'outline'}
      isIconOnly
      className={`rounded-full ${isListening ? 'bg-green-600' : ''}`}
      onClick={onClick}
      isDisabled={disabled}
    >
      {isListening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
    </Button>
  );
}
