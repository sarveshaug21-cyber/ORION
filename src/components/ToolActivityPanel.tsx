import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Loader2,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { cn, formatTime } from '@/lib/utils';
import type { ToolCall } from '@/types';

interface ToolActivityPanelProps {
  toolCalls: ToolCall[];
  className?: string;
}

function StatusIcon({ status }: { status: ToolCall['status'] }) {
  switch (status) {
    case 'executing':
    case 'pending':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-orion-accent" />;
    case 'awaiting_permission':
      return <ShieldAlert className="h-3.5 w-3.5 text-orion-warning" />;
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-orion-success" />;
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-orion-error" />;
    default:
      return <CircleDot className="h-3.5 w-3.5 text-orion-textMuted" />;
  }
}

function statusLabel(status: ToolCall['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'executing':
      return 'Running';
    case 'awaiting_permission':
      return 'Approval needed';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function durationLabel(call: ToolCall, now: number): string | null {
  if (!call.startedAt || (call.status !== 'pending' && call.status !== 'executing' &&
      call.status !== 'awaiting_permission' && !call.completedAt)) {
    return null;
  }
  if (call.result?.error === 'Permission denied') return null;
  const start = call.startedAt instanceof Date ? call.startedAt : new Date(call.startedAt);
  const end = call.completedAt
    ? call.completedAt instanceof Date
      ? call.completedAt
      : new Date(call.completedAt)
    : new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms = Math.max(0, end.getTime() - start.getTime());
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatDetails(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  if (typeof args.command === 'string') return `Command · ${args.command}`;
  if (typeof args.path === 'string') return `Path · ${args.path}`;
  if (typeof args.query === 'string') return `Query · ${args.query}`;
  if (typeof args.name === 'string') return `Target · ${args.name}`;
  if (typeof args.url === 'string') return `URL · ${args.url}`;
  const keys = Object.keys(args);
  if (keys.length === 0) return `Invoking ${toolName}`;
  return `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}`;
}

export function ToolActivityPanel({ toolCalls, className }: ToolActivityPanelProps) {
  const [now, setNow] = useState(Date.now());
  const hasActiveCall = toolCalls.some(
    (call) => call.status === 'pending' || call.status === 'executing' ||
      call.status === 'awaiting_permission'
  );

  useEffect(() => {
    if (!hasActiveCall) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveCall]);

  const items = toolCalls.slice(0, 12);
  const activeCount = toolCalls.filter(
    (call) => call.status === 'pending' || call.status === 'executing' ||
      call.status === 'awaiting_permission'
  ).length;

  return (
    <section className={cn('flex flex-col gap-3 p-4', className)} aria-labelledby="tool-activity-title">
      <div className="flex items-center justify-between">
        <h2
          id="tool-activity-title"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-orion-textMuted"
        >
          Tool activity
        </h2>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-orion-accent/10 px-1.5 py-0.5 text-[10px] text-orion-accent">
              <Loader2 className="h-3 w-3 animate-spin" />
              {activeCount} active
            </span>
          )}
          <span className="font-mono text-[11px] tabular-nums text-orion-textMuted">
            {toolCalls.length}
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-orion-border/70 px-3 py-5 text-center">
          <Wrench className="mx-auto mb-2 h-4 w-4 text-orion-textMuted" />
          <p className="text-xs text-orion-textDim">No tool activity</p>
          <p className="mt-1 text-[10px] leading-relaxed text-orion-textMuted">
            Requests and status updates appear here when available.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((call) => {
            const duration = durationLabel(call, now);
            const action = summarizeArgs(call.toolName, call.arguments);
            const resultText = call.result
              ? call.result.error
                ? `Error: ${call.result.error}`
                : call.result.data !== undefined
                  ? formatDetails(call.result.data)
                  : 'The tool completed without additional output.'
              : null;
            const tone =
              call.status === 'failed'
                ? 'border-orion-error/25 bg-orion-error/[0.035]'
                : call.status === 'awaiting_permission'
                  ? 'border-orion-warning/25 bg-orion-warning/[0.035]'
                  : call.status === 'executing' || call.status === 'pending'
                    ? 'border-orion-accent/25 bg-orion-accent/[0.035]'
                    : 'border-orion-border/70 bg-orion-bg/30';

            return (
              <li
                key={call.id}
                className={cn('rounded-lg border px-3 py-2.5 transition-colors', tone)}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={call.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-all font-mono text-xs font-medium text-orion-text">
                        {call.toolName}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 pt-0.5 text-[9px] font-medium uppercase tracking-wide',
                          call.status === 'failed' && 'text-orion-error',
                          call.status === 'completed' && 'text-orion-success',
                          call.status === 'awaiting_permission' && 'text-orion-warning',
                          (call.status === 'executing' || call.status === 'pending') &&
                            'text-orion-accent'
                        )}
                      >
                        {statusLabel(call.status)}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-[11px] leading-relaxed text-orion-textDim">
                      {action}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-orion-textMuted">
                      <Clock3 className="h-3 w-3" />
                      {duration ? (
                        <span>
                          {call.status === 'awaiting_permission'
                            ? `${duration} waiting`
                            : call.status === 'executing' || call.status === 'pending'
                              ? `${duration} elapsed`
                              : `${duration} duration`}
                        </span>
                      ) : call.completedAt ? (
                        <span>{formatTime(new Date(call.completedAt))}</span>
                      ) : (
                        <span>Timing unavailable</span>
                      )}
                    </div>
                    {call.result?.error && (
                      <p role="alert" className="mt-2 break-words text-[11px] text-orion-error">
                        {call.result.error}
                      </p>
                    )}
                    {call.arguments && Object.keys(call.arguments).length > 0 && (
                      <details className="group mt-2 border-t border-orion-border/60 pt-1.5">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] text-orion-textMuted hover:text-orion-textDim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orion-accent/50">
                          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                          Arguments{resultText ? ' and result' : ''}
                        </summary>
                        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-orion-border/70 bg-orion-bg/70 p-2 font-mono text-[10px] leading-relaxed text-orion-textDim">
                          {formatDetails(call.arguments)}
                        </pre>
                        {resultText && (
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-orion-border/70 bg-orion-bg/70 p-2 font-mono text-[10px] leading-relaxed text-orion-textDim">
                            {resultText}
                          </pre>
                        )}
                      </details>
                    )}
                    {call.status === 'completed' && !call.result && (
                      <p className="mt-1.5 text-[10px] text-orion-textMuted">
                        Output details were not included in the response.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
