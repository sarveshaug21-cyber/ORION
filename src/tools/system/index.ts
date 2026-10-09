/**
 * ORION System Tools
 * Tools for system information and control
 */

import type { ToolResult } from '../../types/index.js';
import { createTool } from '../registry.js';
import { ALLOWED_COMMANDS, isAllowedCommand } from '../command-policy.js';
import { resolveAllowedWorkingDirectory } from '../path-policy.js';
import si from 'systeminformation';

export const systemGetStatus = createTool({
  name: 'system.get_status',
  description: 'Get comprehensive system status including CPU, memory, storage, network, and OS information',
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(_args, _context): Promise<ToolResult> {
    try {
      const [cpu, mem, fs, net, os] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.fsSize(),
        si.networkInterfaces(),
        si.osInfo(),
      ]);

      const cpuLoad = await si.currentLoad();
      const netStats = await si.networkStats();

      const status = {
        cpu: {
          usage: Math.round(cpuLoad.currentLoad * 100) / 100,
          cores: cpu.cores,
          model: cpu.manufacturer + ' ' + cpu.brand,
          temperature: (cpuLoad.cpus[0] as { temp?: number })?.temp ? Math.round((cpuLoad.cpus[0] as { temp?: number }).temp!) : undefined,
        },
        memory: {
          total: mem.total,
          free: mem.free,
          used: mem.active,
          usagePercent: Math.round((mem.active / mem.total) * 10000) / 100,
        },
        storage: fs.map((drive) => ({
          mount: drive.mount,
          total: drive.size,
          free: drive.available,
          used: drive.used,
          usagePercent: Math.round((drive.used / drive.size) * 10000) / 100,
          type: drive.type,
        })),
        network: net.map((iface, i) => ({
          interface: iface.iface,
          ip: iface.ip4 || iface.ip6 || 'N/A',
          mac: iface.mac,
          speed: iface.speed || 0,
          bytesReceived: netStats[i]?.rx_bytes || 0,
          bytesSent: netStats[i]?.tx_bytes || 0,
        })),
        os: {
          platform: os.platform,
          distro: os.distro,
          release: os.release,
          arch: os.arch,
          hostname: os.hostname,
          uptime: process.uptime(),
        },
        timestamp: new Date().toISOString(),
      };

      return { success: true, data: status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get system status',
      };
    }
  },
});

export const systemGetProcesses = createTool({
  name: 'system.get_processes',
  description: 'Get list of running processes with CPU and memory usage',
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum number of processes to return', default: 20 },
      sortBy: { type: 'string', enum: ['cpu', 'memory', 'pid'], description: 'Sort processes by', default: 'cpu' },
    },
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args, _context): Promise<ToolResult> {
    try {
      const limit = (args.limit as number) || 20;
      const sortBy = (args.sortBy as string) || 'cpu';

      const processes = await si.processes();
      const sorted = processes.list
        .sort((a, b) => {
          if (sortBy === 'cpu') return (b as { cpu?: number }).cpu! - (a as { cpu?: number }).cpu!;
          if (sortBy === 'memory') return (b as { mem?: number }).mem! - (a as { mem?: number }).mem!;
          return a.pid - b.pid;
        })
        .slice(0, limit)
        .map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: Math.round(((p as { cpu?: number }).cpu ?? 0) * 100) / 100,
          memory: Math.round(((p as { mem?: number }).mem ?? 0) * 100) / 100,
          memoryBytes: (p as { mem?: number }).mem ?? 0,
          user: p.user,
          command: p.command,
          state: p.state,
        }));

      return { success: true, data: sorted };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get processes',
      };
    }
  },
});

export const systemOpenApp = createTool({
  name: 'system.open_app',
  description: 'Open an application by name or path',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Application name or bundle identifier' },
      path: { type: 'string', description: 'Full path to application executable' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command line arguments' },
    },
    required: [],
    additionalProperties: false,
  },
  permissionLevel: 'SAFE_ACTION',
  async execute(args: { name?: string; path?: string; args?: string[] }, context): Promise<ToolResult> {
    const { name, path, args: appArgs = [] } = args;

    if (!name && !path) {
      return { success: false, error: 'Either name or path must be provided' };
    }

    try {
      const { spawn } = await import('child_process');
      const platform = process.platform;

      let command: string;
      let spawnArgs: string[] = [];

      if (path) {
        command = path;
        spawnArgs = appArgs as string[];
      } else if (platform === 'darwin') {
        command = 'open';
        spawnArgs = ['-a', name as string, ...(appArgs as string[])];
      } else if (platform === 'win32') {
        command = 'start';
        spawnArgs = ['', name as string, ...(appArgs as string[])];
      } else {
        command = name as string;
        spawnArgs = appArgs as string[];
      }

      const child = spawn(command, spawnArgs, {
        detached: true,
        stdio: 'ignore',
        cwd: context.workingDirectory,
      });

      child.unref();

      return { success: true, data: { message: `Started ${name || path}` } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open application',
      };
    }
  },
});

export const systemRunCommand = createTool({
  name: 'system.run_command',
  description: 'Run a shell command and return the output',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 },
    },
    required: ['command'],
    additionalProperties: false,
  },
  permissionLevel: 'REQUIRES_CONFIRMATION',
  async execute(args, context): Promise<ToolResult> {
    const command = args.command;
    const cmdArgs = Array.isArray(args.args)
      ? args.args.filter((argument): argument is string => typeof argument === 'string')
      : [];
    const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;
    const timeout = typeof args.timeout === 'number' && Number.isFinite(args.timeout)
      ? Math.max(1, Math.min(args.timeout, 120_000))
      : 30_000;

    // Validate command against allowlist
    if (typeof command !== 'string' || !isAllowedCommand(command)) {
      return {
        success: false,
        error: `Command "${String(command)}" is not in the allowlist. Allowed: ${ALLOWED_COMMANDS.join(', ')}`,
      };
    }

    // Validate working directory
    try {
      const workingDir = await resolveAllowedWorkingDirectory(
        cwd || context.workingDirectory,
        context.allowedPaths
      );
      const { spawn } = await import('child_process');

      return new Promise((resolve) => {
        const child = spawn(command, cmdArgs, {
          cwd: workingDir,
          timeout,
          shell: false,
          signal: context.signal,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, data: { stdout, stderr, code } });
          } else {
            resolve({ success: false, error: stderr || `Command exited with code ${code}`, data: { stdout, stderr, code } });
          }
        });

        child.on('error', (error) => {
          resolve({ success: false, error: error.message });
        });
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run command',
      };
    }
  },
});

export const systemGetTime = createTool({
  name: 'system.get_time',
  description: 'Get current system time and timezone information',
  schema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['iso', 'locale', 'unix'], description: 'Time format', default: 'iso' },
      timezone: { type: 'string', description: 'IANA timezone (e.g., "America/New_York")' },
    },
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args: { format?: 'iso' | 'locale' | 'unix'; timezone?: string }, _context): Promise<ToolResult> {
    const { format = 'iso', timezone } = args;

    try {
      const now = new Date();
      let result: string | number;

      switch (format) {
        case 'iso':
          result = timezone
            ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(now)
            : now.toISOString();
          break;
        case 'locale':
          result = timezone
            ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'medium' }).format(now)
            : now.toLocaleString();
          break;
        case 'unix':
          result = Math.floor(now.getTime() / 1000);
          break;
        default:
          result = now.toISOString();
      }

      return {
        success: true,
        data: {
          time: result,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          timestamp: now.getTime(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get time',
      };
    }
  },
});

// Export all system tools
export const systemTools = [
  systemGetStatus,
  systemGetProcesses,
  systemOpenApp,
  systemRunCommand,
  systemGetTime,
];