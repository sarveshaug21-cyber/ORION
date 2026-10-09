import {
  Activity,
  AlertCircle,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Network,
  Server,
} from 'lucide-react';
import { cn, formatBytes, formatTime, formatUptime } from '@/lib/utils';
import type { SystemStatus } from '@/types';

interface SystemStatusPanelProps {
  status: SystemStatus | null;
  loading: boolean;
  error: string | null;
  connectionStatus: 'online' | 'connecting' | 'offline';
}

export function SystemStatusPanel({
  status,
  loading,
  error,
  connectionStatus,
}: SystemStatusPanelProps) {
  return (
    <section className="border-b border-orion-border/80 p-4" aria-labelledby="system-status-title">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-orion-accent/20 bg-orion-accent/10 text-orion-accent">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <h2 id="system-status-title" className="text-sm font-semibold text-orion-text">
              System status
            </h2>
            <p className="text-[10px] text-orion-textMuted">
              {status
                ? updatedLabel(status.timestamp)
                : connectionStatus === 'online'
                  ? 'Live system metrics'
                  : connectionStatus === 'connecting'
                    ? 'Connecting to ORION'
                    : 'ORION is offline'}
            </p>
          </div>
        </div>
        {loading && connectionStatus !== 'offline' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-orion-accent" aria-label="Refreshing" />
        )}
      </div>

      {status && connectionStatus === 'offline' && (
        <p role="status" className="mb-3 rounded-lg border border-orion-warning/20 bg-orion-warning/5 px-2.5 py-2 text-[10px] leading-relaxed text-orion-warning">
          ORION is offline. Showing the last received metrics.
        </p>
      )}

      {error && (
        <p
          role="status"
          className="mb-3 flex items-start gap-2 rounded-lg border border-orion-error/20 bg-orion-error/5 px-2.5 py-2 text-[11px] leading-relaxed text-orion-error"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{status ? `Refresh failed: ${error}` : error}</span>
        </p>
      )}

      {!status ? (
        loading && !error && connectionStatus !== 'offline' ? (
          <div className="space-y-2.5" aria-label="Loading system metrics">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-lg bg-orion-bgTeritary/70" />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-orion-border px-3 py-5 text-center">
            <Server className="mx-auto mb-2 h-4 w-4 text-orion-textMuted" />
            <p className="text-xs text-orion-textDim">System data unavailable</p>
            {!error && (
              <p className="mt-1 text-[10px] leading-relaxed text-orion-textMuted">
                {connectionStatus === 'connecting'
                  ? 'Waiting for a connection to retrieve system metrics.'
                  : connectionStatus === 'offline'
                    ? 'Reconnect to ORION to retrieve system metrics.'
                    : 'Waiting for the backend to provide system metrics.'}
              </p>
            )}
          </div>
        )
      ) : (
        <div className="space-y-2">
          <MetricCard
            icon={<Cpu className="h-3.5 w-3.5" />}
            label="Processor"
            value={percent(status.cpu.usage)}
            detail={`${status.cpu.cores} cores · ${status.cpu.model}`}
            percent={status.cpu.usage}
          />
          <MetricCard
            icon={<MemoryStick className="h-3.5 w-3.5" />}
            label="Memory"
            value={percent(status.memory.usagePercent)}
            detail={`${formatBytes(status.memory.used)} of ${formatBytes(status.memory.total)}`}
            percent={status.memory.usagePercent}
          />
          {status.storage[0] && (
            <MetricCard
              icon={<HardDrive className="h-3.5 w-3.5" />}
              label={`Storage · ${status.storage[0].mount}`}
              value={percent(status.storage[0].usagePercent)}
              detail={`${formatBytes(status.storage[0].free)} available`}
              percent={status.storage[0].usagePercent}
            />
          )}
          <div className="rounded-lg border border-orion-border/70 bg-orion-bg/30 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[11px] font-medium text-orion-textDim">
              <Network className="h-3.5 w-3.5 text-orion-textMuted" />
              <span>Network</span>
            </div>
            {status.network.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {status.network.slice(0, 2).map((network) => (
                  <li key={network.interface} className="flex min-w-0 items-center justify-between gap-2 text-[10px]">
                    <span className="truncate text-orion-textMuted">
                      {network.interface} · {network.ip}
                    </span>
                    <span className="shrink-0 font-mono text-orion-textDim">
                      ↑ {formatBytes(network.bytesSent)} · ↓ {formatBytes(network.bytesReceived)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-orion-textMuted">No active interfaces reported</p>
            )}
          </div>
          <div className="border-t border-orion-border/70 pt-2 text-[10px] text-orion-textMuted">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">
                {status.os.distro} {status.os.release} · {status.os.arch}
              </span>
              <span className="shrink-0">{formatUptime(status.os.uptime)}</span>
            </div>
            <div className="mt-1 truncate">{status.os.hostname}</div>
            {status.cpu.temperature !== undefined && (
              <div className="mt-1">CPU temperature · {status.cpu.temperature}°</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  percent: rawPercent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  const percent = Math.min(100, Math.max(0, rawPercent));
  const barColor =
    percent >= 90 ? 'bg-orion-error' : percent >= 75 ? 'bg-orion-warning' : 'bg-orion-accent';

  return (
    <div className="rounded-lg border border-orion-border/70 bg-orion-bg/30 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-orion-textMuted">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-orion-textDim">
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-orion-text">{value}</span>
      </div>
      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-orion-border/70"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', barColor)} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 truncate text-[10px] text-orion-textMuted">{detail}</p>
    </div>
  );
}

function percent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(1) : '—'}%`;
}

function updatedLabel(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Update time unavailable' : `Updated ${formatTime(date)}`;
}
