import { MessageSquarePlus, MessagesSquare } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { Conversation } from '@/types';

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  collapsed?: boolean;
  className?: string;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNew,
  collapsed,
  className,
}: ConversationSidebarProps) {
  if (collapsed) return null;

  return (
    <aside
      className={cn(
        'flex w-60 shrink-0 flex-col border-r border-orion-border bg-orion-bgSecondary/40',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-orion-border px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-orion-textMuted">
          <MessagesSquare className="h-3.5 w-3.5" />
          Sessions
        </div>
        <button
          type="button"
          onClick={onNew}
          className="btn-ghost h-8 w-8 rounded-lg p-0"
          title="New conversation (⌘N)"
          aria-label="New conversation"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-orion-textMuted">
            No conversations yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((conv) => {
              const updated =
                conv.updatedAt instanceof Date ? conv.updatedAt : new Date(conv.updatedAt);
              const active = conv.id === activeConversationId;
              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conv.id)}
                    className={cn(
                      'w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-ring',
                      active
                        ? 'bg-orion-accent/10 text-orion-text'
                        : 'text-orion-textDim hover:bg-orion-bgTeritary hover:text-orion-text'
                    )}
                  >
                    <div className="truncate text-sm font-medium">
                      {conv.title || 'Untitled'}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-orion-textMuted">
                      <span>{formatDate(updated)}</span>
                      <span>·</span>
                      <span>{conv.messageCount} msgs</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
