import { useState } from 'react';
import { Send } from 'lucide-react';

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
    <div className="flex-1 flex items-center gap-2 glass rounded-2xl px-4 py-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        placeholder="Type a message…"
        disabled={disabled}
        className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 text-sm"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !text.trim()}
        className="p-2 rounded-xl bg-primary/20 hover:bg-primary/30 transition disabled:opacity-30"
      >
        <Send size={16} className="text-primary" />
      </button>
    </div>
  );
}
