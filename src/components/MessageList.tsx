import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Loader2, ShieldCheck } from 'lucide-react';
import { OrionMark } from './OrionMark';
import { cn, formatTime } from '@/lib/utils';
import type { AIState, ConversationMessage } from '@/types';

export interface DisplayMessage extends ConversationMessage {
  streaming?: boolean;
}

interface MessageListProps {
  messages: DisplayMessage[];
  streamingContent?: string;
  isStreaming?: boolean;
  aiState: AIState;
  className?: string;
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  aiState,
  className,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const empty = messages.length === 0 && !isStreaming && !streamingContent;
  const waitingForAssistant =
    (aiState === 'THINKING' || aiState === 'EXECUTING' || aiState === 'WAITING_FOR_PERMISSION') &&
    !streamingContent;

  useEffect(() => {
    if (empty) followLatestRef.current = true;
    if (!followLatestRef.current) {
      setShowJumpToLatest(true);
      return;
    }
    bottomRef.current?.scrollIntoView({
      behavior: isStreaming ? 'auto' : 'smooth',
      block: 'end',
    });
    setShowJumpToLatest(false);
  }, [messages, streamingContent, isStreaming, aiState, empty]);

  const handleScroll = () => {
    const element = scrollContainerRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    followLatestRef.current = atBottom;
    setShowJumpToLatest(!atBottom);
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      tabIndex={0}
      aria-label="Conversation messages"
      className={cn(
        'custom-scrollbar relative flex-1 overflow-y-auto px-4 py-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orion-accent/30 md:px-8',
        className
      )}
    >
      {empty ? (
        <EmptyState />
      ) : (
        <div
          className="mx-auto flex w-full max-w-3xl flex-col gap-6"
          role="log"
          aria-label="Conversation"
          aria-live="off"
          aria-busy={Boolean(isStreaming || waitingForAssistant)}
        >
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}

          {isStreaming && streamingContent !== undefined && (
            <MessageRow
              message={{
                id: 'streaming',
                conversationId: '',
                role: 'assistant',
                content: streamingContent,
                createdAt: new Date(),
                streaming: true,
              }}
            />
          )}

          {waitingForAssistant && (
            <div className="flex items-start gap-3 animate-slide-up" role="status" aria-live="polite">
              <OrionMark size={28} />
              <div
                className={cn(
                  'rounded-xl border px-4 py-3',
                  aiState === 'WAITING_FOR_PERMISSION'
                    ? 'border-orion-warning/25 bg-orion-warning/5'
                    : aiState === 'EXECUTING'
                      ? 'border-orion-warning/20 bg-orion-bgTeritary/60'
                      : 'border-orion-accent/20 bg-orion-accent/5'
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-2 text-sm',
                    aiState === 'WAITING_FOR_PERMISSION' || aiState === 'EXECUTING'
                      ? 'text-orion-warning'
                      : 'text-orion-accent'
                  )}
                >
                  {aiState === 'WAITING_FOR_PERMISSION' ? (
                    <ShieldCheck className="h-4 w-4" />
                  ) : aiState === 'EXECUTING' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="flex gap-1" aria-hidden="true">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orion-accent" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orion-accent [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orion-accent [animation-delay:300ms]" />
                    </span>
                  )}
                  {aiState === 'WAITING_FOR_PERMISSION'
                    ? 'Waiting for your approval'
                    : aiState === 'EXECUTING'
                      ? 'Running an approved action'
                      : 'Thinking through your request'}
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}
      {showJumpToLatest && (
        <button
          type="button"
          onClick={() => {
            followLatestRef.current = true;
            setShowJumpToLatest(false);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
          className="btn-secondary absolute bottom-4 right-4 z-10 h-9 gap-2 rounded-full border-orion-borderLight/80 bg-orion-bgSecondary/95 px-3 text-xs shadow-lg"
          aria-label="Jump to latest message"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          Latest
        </button>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isError = message.metadata?.error === true;
  const created =
    message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);

  if (isUser) {
    return (
      <div className="flex justify-end animate-slide-up">
        <div className="max-w-[90%] space-y-1 sm:max-w-[85%]">
          <div className="break-words rounded-2xl rounded-tr-md border border-orion-accent/20 bg-orion-accent/10 px-4 py-3 text-[15px] leading-relaxed text-orion-text">
            <MessageContent content={message.content} />
          </div>
          <div className="pr-1 text-right text-[10px] text-orion-textMuted">{formatTime(created)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 animate-slide-up">
      <OrionMark size={28} className="mt-0.5 shrink-0" />
      <div className="min-w-0 max-w-[90%] flex-1 space-y-1 sm:max-w-[85%]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-orion-accent">ORION</span>
          {message.streaming && (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-orion-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orion-accent" />
              Live response
            </span>
          )}
          {isTool && (
            <span className="text-[10px] uppercase tracking-wider text-orion-warning">Tool</span>
          )}
        </div>
        <div
          className={cn(
            'break-words rounded-2xl rounded-tl-md border px-4 py-3 text-[15px] leading-7',
            isError
              ? 'border-orion-error/30 bg-orion-error/10 text-orion-error'
              : isTool
                ? 'border-orion-warning/20 bg-orion-warning/5 font-mono text-sm text-orion-warning'
                : message.streaming
                  ? 'border-orion-accent/20 bg-orion-bgSecondary/80 text-orion-text shadow-[0_8px_24px_rgba(0,0,0,0.12)]'
                  : 'border-orion-border/80 bg-orion-bgTeritary/50 text-orion-text'
          )}
        >
          <MessageContent content={message.content || (message.streaming ? '' : '…')} />
          {message.streaming && (
            <span
              className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-orion-accent align-middle"
              aria-hidden="true"
            />
          )}
        </div>
        {!message.streaming && (
          <div className="pl-1 text-[10px] text-orion-textMuted">{formatTime(created)}</div>
        )}
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const nl = inner.indexOf('\n');
          const lang = nl > -1 ? inner.slice(0, nl).trim() : '';
          const code = nl > -1 ? inner.slice(nl + 1) : inner;
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-lg border border-orion-border bg-orion-bg/80 p-3 font-mono text-[13px] text-orion-text"
            >
              {lang && (
                <div className="mb-2 text-[10px] uppercase tracking-wider text-orion-textMuted">
                  {lang}
                </div>
              )}
              <code>{code}</code>
            </pre>
          );
        }

        return (
          <span key={i} className="whitespace-pre-wrap">
            {part.split(/(`[^`]+`)/g).map((seg, j) => {
              if (seg.startsWith('`') && seg.endsWith('`')) {
                return (
                  <code
                    key={j}
                    className="rounded bg-orion-bg px-1.5 py-0.5 font-mono text-[13px] text-orion-accentGlow"
                  >
                    {seg.slice(1, -1)}
                  </code>
                );
              }
              return <span key={j}>{seg}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 pb-10 text-center">
      <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-orion-accent/20 bg-orion-accent/[0.06] shadow-[0_12px_40px_rgba(6,182,212,0.07)]">
        <OrionMark size={34} />
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-orion-accent/80">
        Personal computer intelligence
      </p>
      <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-orion-text sm:text-4xl">
        Your computer. Understood.
      </h2>
      <p className="mt-4 max-w-lg text-sm leading-6 text-orion-textDim">
        Ask about your system or give ORION a task. It can inspect live system information, work with
        files, and ask before actions that need your approval.
      </p>
      <div className="mt-8 flex items-center gap-2 text-[11px] text-orion-textMuted">
        <span className="h-1.5 w-1.5 rounded-full bg-orion-accent/70" aria-hidden="true" />
        Start with a command below
      </div>
    </div>
  );
}
