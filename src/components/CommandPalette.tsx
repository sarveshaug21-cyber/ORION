import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import {
  MessageSquarePlus,
  Settings,
  Mic,
  Keyboard,
  MessagesSquare,
  Activity,
} from 'lucide-react';
import type { Conversation, UserSettings } from '@/types';

interface CommandPaletteProps {
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onConversationSelect: (id: string) => void;
  settings: UserSettings;
  onSettingsChange: (settings: Partial<UserSettings>) => void;
  onOpenSettings: () => void;
  onFocusInput: () => void;
  onToggleVoice?: () => void;
}

export function CommandPalette({
  onClose,
  conversations,
  onNewConversation,
  onConversationSelect,
  settings,
  onSettingsChange,
  onOpenSettings,
  onFocusInput,
  onToggleVoice,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const recent = useMemo(() => conversations.slice(0, 8), [conversations]);

  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div
        className="fixed left-1/2 top-[18%] z-50 w-full max-w-xl -translate-x-1/2 px-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          className="overflow-hidden rounded-xl border border-orion-border bg-orion-bgSecondary shadow-glow-lg"
          label="Command palette"
        >
          <div className="flex items-center gap-2 border-b border-orion-border px-4">
            <Keyboard className="h-4 w-4 text-orion-textMuted" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search…"
              className="cmdk-input h-12"
            />
          </div>

          <Command.List className="max-h-80 overflow-auto py-2">
            <Command.Empty className="cmdk-empty">No results.</Command.Empty>

            <Command.Group heading="Actions" className="cmdk-group-heading [&_[cmdk-group-heading]]:contents">
              <div className="cmdk-group-heading">Actions</div>
              <Command.Item
                className="cmdk-item"
                onSelect={() =>
                  run(() => {
                    onNewConversation();
                  })
                }
              >
                <MessageSquarePlus className="h-4 w-4" />
                New conversation
              </Command.Item>
              <Command.Item className="cmdk-item" onSelect={() => run(onFocusInput)}>
                <Activity className="h-4 w-4" />
                Focus command input
              </Command.Item>
              <Command.Item className="cmdk-item" onSelect={() => run(onOpenSettings)}>
                <Settings className="h-4 w-4" />
                Open settings
              </Command.Item>
              {onToggleVoice && (
                <Command.Item className="cmdk-item" onSelect={() => run(onToggleVoice)}>
                  <Mic className="h-4 w-4" />
                  {settings.voice.enabled ? 'Disable voice input' : 'Enable voice input'}
                </Command.Item>
              )}
              <Command.Item
                className="cmdk-item"
                onSelect={() =>
                  run(() =>
                    onSettingsChange({
                      appearance: {
                        ...settings.appearance,
                        compactMode: !settings.appearance.compactMode,
                      },
                    })
                  )
                }
              >
                <Settings className="h-4 w-4" />
                Toggle compact mode
              </Command.Item>
            </Command.Group>

            {recent.length > 0 && (
              <Command.Group>
                <div className="cmdk-group-heading">Conversations</div>
                {recent.map((conv) => (
                  <Command.Item
                    key={conv.id}
                    className="cmdk-item"
                    value={`${conv.title} ${conv.id}`}
                    onSelect={() => run(() => onConversationSelect(conv.id))}
                  >
                    <MessagesSquare className="h-4 w-4" />
                    <span className="truncate">{conv.title || 'Untitled'}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
