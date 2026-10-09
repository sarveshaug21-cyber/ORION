import { useEffect, useState } from 'react';
import {
  PanelLeft,
  PanelRight,
  Settings,
  Command as CommandIcon,
  Wifi,
  WifiOff,
  Loader2,
  Circle,
  X,
} from 'lucide-react';
import { OrionMark } from './OrionMark';
import { AIActivityIndicator } from './AIActivityIndicator';
import { ConversationSidebar } from './ConversationSidebar';
import { MessageList, type DisplayMessage } from './MessageList';
import { CommandInput } from './CommandInput';
import { SystemStatusPanel } from './SystemStatusPanel';
import { ToolActivityPanel } from './ToolActivityPanel';
import { cn } from '@/lib/utils';
import type {
  AIState,
  Conversation,
  Session,
  SystemStatus,
  ToolCall,
  UserSettings,
} from '@/types';

interface MainLayoutProps {
  session: Session | null;
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: DisplayMessage[];
  streamingContent: string;
  isStreaming: boolean;
  settings: UserSettings;
  aiState: AIState;
  toolCalls: ToolCall[];
  systemStatus: SystemStatus | null;
  systemStatusLoading: boolean;
  systemStatusError: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  providerName: string;
  modelName: string;
  inputError: string | null;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onSendMessage: (content: string) => void;
  onCancelGeneration: () => void;
  onClearInputError: () => void;
  onListeningChange?: (listening: boolean) => void;
  onNewConversation: () => void;
  onConversationSelect: (id: string) => void;
  onToggleSettings: () => void;
  onToggleCommandPalette: () => void;
}

export function MainLayout({
  session,
  conversations,
  activeConversationId,
  messages,
  streamingContent,
  isStreaming,
  settings,
  aiState,
  toolCalls,
  systemStatus,
  systemStatusLoading,
  systemStatusError,
  isConnected,
  isConnecting,
  providerName,
  modelName,
  inputError,
  inputRef,
  onSendMessage,
  onCancelGeneration,
  onClearInputError,
  onListeningChange,
  onNewConversation,
  onConversationSelect,
  onToggleSettings,
  onToggleCommandPalette,
}: MainLayoutProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const compact = settings.appearance.compactMode;

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) {
        setRightOpen(false);
      }
      if (window.innerWidth < 768) {
        setLeftOpen(false);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      className={cn('relative flex h-full min-h-0 flex-col', !settings.appearance.animationsEnabled && '[&_*]:!animate-none')}
      style={{ fontSize: settings.appearance.fontSize }}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-orion-border bg-orion-bgSecondary/70 px-3 backdrop-blur-md md:px-4">
        <button
          type="button"
          className="btn-ghost h-9 w-9 p-0 md:hidden"
          onClick={() => setLeftOpen((v) => !v)}
          aria-expanded={leftOpen}
          aria-label="Toggle sessions"
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5">
          <OrionMark size={28} pulsing={aiState !== 'IDLE' && aiState !== 'COMPLETED'} />
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold tracking-[0.18em] text-orion-text">
              ORION
            </div>
            <div className="hidden text-[10px] text-orion-textMuted sm:block">
              Your computer. Understood.
            </div>
          </div>
        </div>

        <div className="mx-2 hidden h-6 w-px bg-orion-border sm:block" />

        <AIActivityIndicator state={aiState} compact className="hidden sm:inline-flex" />

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-lg border border-orion-border/80 bg-orion-bg/40 px-2.5 py-1.5 lg:flex">
            <Circle
              className={cn(
                'h-2 w-2 fill-current',
                isConnected
                  ? 'text-orion-success'
                  : isConnecting
                    ? 'text-orion-warning'
                    : 'text-orion-error'
              )}
            />
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-orion-text">
                {modelName || 'Model not configured'}
              </div>
              <div className="truncate text-[10px] text-orion-textMuted">
                {providerName || 'No provider selected'}
                {session?.workingDirectory ? ` · ${shortPath(session.workingDirectory)}` : ''}
              </div>
            </div>
          </div>

          <div
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px]',
              isConnected
                ? 'border-orion-success/25 bg-orion-success/5 text-orion-success'
                : isConnecting
                  ? 'border-orion-warning/25 bg-orion-warning/5 text-orion-warning'
                  : 'border-orion-error/25 bg-orion-error/5 text-orion-error'
            )}
            title={isConnected ? 'Connected to ORION' : isConnecting ? 'Connecting to ORION' : 'ORION is offline'}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {isConnected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : isConnecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {isConnected ? 'Online' : isConnecting ? 'Connecting' : 'Offline'}
            </span>
          </div>

          <button
            type="button"
            className="btn-ghost h-9 w-9 p-0"
            onClick={onToggleCommandPalette}
            title="Command palette (Cmd/Ctrl+K)"
            aria-label="Open command palette"
          >
            <CommandIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost h-9 w-9 p-0"
            onClick={onToggleSettings}
            title="Settings (⌘,)"
            aria-label="Open settings"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost hidden h-9 w-9 p-0 lg:inline-flex"
            onClick={() => setRightOpen((v) => !v)}
            aria-expanded={rightOpen}
            aria-label="Toggle system panel"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <button
            type="button"
            className="absolute inset-x-0 bottom-0 top-14 z-10 bg-black/40 md:hidden"
            onClick={() => setLeftOpen(false)}
            aria-label="Close conversations panel"
          />
        )}

        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={onConversationSelect}
          onNew={onNewConversation}
          collapsed={!leftOpen}
          className={cn(
            leftOpen &&
              'absolute inset-y-14 left-0 z-20 w-[min(18rem,85vw)] shadow-glow md:static md:inset-auto md:z-auto md:w-60 md:shadow-none',
            compact && 'md:w-52'
          )}
        />

        {!leftOpen && (
          <button
            type="button"
            className="btn-ghost absolute left-2 top-16 z-10 hidden h-9 w-9 border border-orion-border bg-orion-bgSecondary p-0 md:inline-flex"
            onClick={() => setLeftOpen(true)}
            aria-label="Show sessions"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_top,_rgba(6,182,212,0.04),_transparent_55%)]">
          <div className="flex items-center justify-between border-b border-orion-border/60 px-4 py-2 sm:hidden">
            <AIActivityIndicator state={aiState} compact />
            <button
              type="button"
              className="btn-ghost h-8 px-2 text-xs"
              onClick={() => setRightOpen((v) => !v)}
              aria-expanded={rightOpen}
              aria-label={`${rightOpen ? 'Hide' : 'Show'} system status panel`}
            >
              Status
            </button>
          </div>

          <MessageList
            key={activeConversationId || 'empty'}
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            aiState={aiState}
          />

          <CommandInput
            onSend={onSendMessage}
            onCancel={onCancelGeneration}
            canSend={isConnected}
            connectionStatus={isConnected ? 'online' : isConnecting ? 'connecting' : 'offline'}
            aiState={aiState}
            voiceEnabled={settings.voice.enabled}
            language={settings.voice.language}
            error={inputError}
            onClearError={onClearInputError}
            onListeningChange={onListeningChange}
            inputRef={inputRef}
          />
        </main>

        {rightOpen && (
          <aside
            aria-label="System and tool activity"
            className="custom-scrollbar absolute inset-y-14 right-0 z-20 flex w-72 flex-col overflow-y-auto border-l border-orion-border bg-orion-bgSecondary/95 shadow-glow lg:static lg:z-0 lg:bg-orion-bgSecondary/40 lg:shadow-none"
          >
            <div className="flex items-center justify-between border-b border-orion-border px-4 py-3 lg:hidden">
              <span className="text-xs font-semibold tracking-wide text-orion-text">
                System overview
              </span>
              <button
                type="button"
                className="btn-ghost h-8 w-8 p-0"
                onClick={() => setRightOpen(false)}
                aria-label="Close system overview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SystemStatusPanel
              status={systemStatus}
              loading={systemStatusLoading}
              error={systemStatusError}
              connectionStatus={isConnected ? 'online' : isConnecting ? 'connecting' : 'offline'}
            />
            <div className="border-t border-orion-border" />
            <ToolActivityPanel toolCalls={toolCalls} />
            {providerName && (
              <div className="mt-auto border-t border-orion-border p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-orion-textMuted">
                  Provider
                </div>
                <div className="mt-2 font-mono text-xs text-orion-text">{modelName || '—'}</div>
                <div className="mt-0.5 text-[11px] text-orion-textMuted">{providerName}</div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}
