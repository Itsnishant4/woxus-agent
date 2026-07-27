import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@heroui/react';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="flex-1 flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring transition-shadow">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
        placeholder="Type a message..."
        disabled={disabled}
        className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50"
      />
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground"
        onClick={handleSubmit}
        isDisabled={disabled || !text.trim()}
      >
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
