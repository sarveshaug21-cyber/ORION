import { useState } from 'react';
import { Plus, MessageSquare, Trash2, Edit2, Search } from 'lucide-react';
import { cn, formatDateTime } from '../lib/utils';
import type { Conversation } from '../types';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onConversationSelect: (id: string) => void;
  onNewConversation: () => void;
}

export function Sidebar({ isOpen, onClose, conversations, activeConversationId, onConversationSelect, onNewConversation }: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const saveEdit = (_id: string) => {
    // In real app, send to server
    setEditingId(null);
  };

  const deleteConversation = (_id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // In real app, send to server
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed lg:relative left-0 top-14 bottom-0 z-40 flex flex-col transition-transform duration-300 ease-out',
        'w-72 border-r border-orion-border bg-orion-bgSecondary/80 backdrop-blur-xl',
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Header */}
        <div className="p-4 border-b border-orion-border flex items-center justify-between">
          <h2 className="font-semibold text-orion-text">Conversations</h2>
          <button
            onClick={onNewConversation}
            className="btn-primary text-sm px-3 py-1.5"
            aria-label="New conversation"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            New
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-orion-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-orion-textMuted" />
            <input
              type="text"
              placeholder="Search conversations..."
              className="input pl-10 pr-4 py-2 text-sm"
              aria-label="Search conversations"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-orion-textMuted">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1">Start a new conversation to begin</p>
            </div>
          ) : (
            <ul className="divide-y divide-orion-border/50" role="list">
              {conversations.map((conv) => (
                <li key={conv.id}>
                  <ConversationItem
                    conversation={conv}
                    isActive={conv.id === activeConversationId}
                    isHovered={hoveredId === conv.id}
                    isEditing={editingId === conv.id}
                    editTitle={editTitle}
                    onSelect={() => onConversationSelect(conv.id)}
                    onHover={() => setHoveredId(conv.id)}
                    onLeave={() => setHoveredId(null)}
                    onEditStart={startEdit}
                    onEditSave={saveEdit}
                    onEditCancel={() => setEditingId(null)}
                    onEditTitleChange={setEditTitle}
                    onDelete={deleteConversation}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-orion-border">
          <div className="flex items-center gap-3 text-xs text-orion-textMuted">
            <span className="flex-1 truncate">No workspace selected</span>
          </div>
        </div>
      </aside>
    </>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isHovered: boolean;
  isEditing: boolean;
  editTitle: string;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
  onEditStart: (conv: Conversation) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onEditTitleChange: (title: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function ConversationItem({
  conversation,
  isActive,
  isHovered,
  isEditing,
  editTitle,
  onSelect,
  onHover,
  onLeave,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditTitleChange,
  onDelete,
}: ConversationItemProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onEditSave(conversation.id);
    if (e.key === 'Escape') onEditCancel();
  };

  return (
    <div
      className={cn(
        'group relative',
        isActive && 'bg-orion-accent/5',
        isHovered && !isActive && 'bg-orion-bg/50'
      )}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {isEditing ? (
        <div className="p-3">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={onEditCancel}
            autoFocus
            className="input text-sm px-3 py-2 w-full"
            aria-label="Edit conversation title"
          />
        </div>
      ) : (
        <button
          onClick={onSelect}
          className={cn(
            'w-full px-3 py-3 text-left transition-colors',
            'hover:bg-orion-bg/50',
            isActive && 'bg-orion-accent/5 border-l-2 border-orion-accent'
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0 text-left">
              <p className={cn(
                'font-medium truncate',
                isActive ? 'text-orion-text' : 'text-orion-textDim'
              )}>
                {conversation.title}
              </p>
              <p className="text-xs text-orion-textMuted truncate mt-0.5">
                {formatDateTime(conversation.updatedAt)}
              </p>
              <p className="text-xs text-orion-textMuted mt-0.5">
                {conversation.messageCount} messages
              </p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => { e.stopPropagation(); onEditStart(conversation); }}
                className="btn-ghost p-1.5 rounded hover:bg-orion-bgTeritary"
                aria-label="Rename"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => onDelete(conversation.id, e)}
                className="btn-ghost p-1.5 rounded hover:bg-orion-error/10 hover:text-orion-error"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

