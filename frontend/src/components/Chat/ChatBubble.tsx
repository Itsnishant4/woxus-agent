import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@heroui/react';

interface ChatBubbleProps {
  role: string;
  content: string;
}

export default function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex items-start gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <Avatar className="h-7 w-7 mt-0.5 shrink-0">
        <AvatarFallback
          className={cn(
            'text-[8px] font-medium',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white'
          )}
        >
          {isUser ? 'U' : 'W'}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
        )}
      >
        {content}
      </div>
    </div>
  );
}
