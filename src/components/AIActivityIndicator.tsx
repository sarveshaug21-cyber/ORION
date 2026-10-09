import { cn } from '@/lib/utils';
import type { AIState } from '@/types';

const STATE_CONFIG: Record<
  AIState,
  { label: string; description: string; dot: string; ring: string; text: string }
> = {
  IDLE: {
    label: 'Idle',
    description: 'Ready for commands',
    dot: 'bg-orion-textMuted',
    ring: 'ring-orion-borderLight/40',
    text: 'text-orion-textDim',
  },
  LISTENING: {
    label: 'Listening',
    description: 'Capturing voice input',
    dot: 'bg-orion-accent animate-pulse',
    ring: 'ring-orion-accent/30',
    text: 'text-orion-accent',
  },
  THINKING: {
    label: 'Thinking',
    description: 'Reasoning through your request',
    dot: 'bg-orion-accent animate-pulse-slow',
    ring: 'ring-orion-accent/40',
    text: 'text-orion-accent',
  },
  EXECUTING: {
    label: 'Executing',
    description: 'Running system tools',
    dot: 'bg-orion-warning animate-pulse',
    ring: 'ring-orion-warning/30',
    text: 'text-orion-warning',
  },
  WAITING_FOR_PERMISSION: {
    label: 'Awaiting permission',
    description: 'Confirmation required',
    dot: 'bg-orion-warning',
    ring: 'ring-orion-warning/40',
    text: 'text-orion-warning',
  },
  COMPLETED: {
    label: 'Completed',
    description: 'Response ready',
    dot: 'bg-orion-success',
    ring: 'ring-orion-success/30',
    text: 'text-orion-success',
  },
  ERROR: {
    label: 'Error',
    description: 'Something went wrong',
    dot: 'bg-orion-error',
    ring: 'ring-orion-error/40',
    text: 'text-orion-error',
  },
};

interface AIActivityIndicatorProps {
  state: AIState;
  compact?: boolean;
  className?: string;
}

export function AIActivityIndicator({ state, compact = false, className }: AIActivityIndicatorProps) {
  const config = STATE_CONFIG[state];

  if (compact) {
    return (
      <div
        className={cn('inline-flex items-center gap-2', className)}
        title={`${config.label} — ${config.description}`}
        role="status"
        aria-atomic="true"
        aria-live="polite"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-40',
              state !== 'IDLE' && state !== 'COMPLETED' && state !== 'ERROR' && 'animate-ping',
              config.dot.split(' ')[0]
            )}
          />
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', config.dot)} />
        </span>
        <span className={cn('text-xs font-medium uppercase tracking-wide', config.text)}>
          {config.label}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-orion-border/80 bg-orion-bgSecondary/60 px-3 py-2',
        className
      )}
      aria-live="polite"
      role="status"
      aria-atomic="true"
    >
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-full ring-1', config.ring, config.text)}>
        <span className={cn('h-2.5 w-2.5 rounded-full', config.dot)} />
      </div>
      <div className="min-w-0">
        <div className={cn('text-sm font-medium', config.text)}>{config.label}</div>
        <div className="truncate text-xs text-orion-textMuted">{config.description}</div>
      </div>
    </div>
  );
}
