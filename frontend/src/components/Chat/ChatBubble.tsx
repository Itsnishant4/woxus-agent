interface ChatBubbleProps {
  role: string;
  content: string;
}

export default function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} fade-in`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
        isUser
          ? 'bg-gradient-to-br from-primary/30 to-accent/20 rounded-br-md'
          : 'bg-white/10 rounded-bl-md'
      }`}>
        <p className="text-sm leading-relaxed">{content}</p>
      </div>
    </div>
  );
}
