/**
 * ORION Terminal Tools
 * Tools for terminal/shell operations
 */

import type { ToolResult } from '../../types/index.js';
import { createTool } from '../registry.js';
import { ALLOWED_COMMANDS, isAllowedCommand } from '../command-policy.js';
import { resolveAllowedWorkingDirectory } from '../path-policy.js';

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string');
}

export const terminalRun = createTool({
  name: 'terminal.run',
  description: 'Execute an allowlisted command in the selected working directory',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
      cwd: { type: 'string', description: 'Working directory' },
      env: { type: 'object', description: 'Environment variables', additionalProperties: { type: 'string' } },
      timeout: { type: 'number', description: 'Timeout in milliseconds', default: 60000 },
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
    const env = isStringRecord(args.env) ? args.env : {};
    const timeout = typeof args.timeout === 'number' && Number.isFinite(args.timeout)
      ? Math.max(1, Math.min(args.timeout, 120_000))
      : 60_000;

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
          env: {
            ...process.env,
            ...Object.fromEntries(
              Object.entries(env).filter(([key]) =>
                !/^(?:PATH|NODE_OPTIONS|LD_.*|DYLD_.*)$/i.test(key)
              )
            ),
          },
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

export const terminalSessionCreate = createTool({
  name: 'terminal.session_create',
  description: 'Create a new persistent terminal session',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Session name' },
      cwd: { type: 'string', description: 'Working directory' },
      shell: { type: 'string', description: 'Shell to use (bash, zsh, fish, etc.)', default: 'bash' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  permissionLevel: 'SAFE_ACTION',
  async execute(args, context): Promise<ToolResult> {
    const { name, cwd, shell = 'bash' } = args;

    // In a real implementation, this would create a persistent PTY session
    // For now, return a placeholder
    return {
      success: true,
      data: {
        name,
        cwd: cwd || context.workingDirectory,
        shell,
        note: 'Persistent terminal sessions require PTY integration (node-pty)',
      },
    };
  },
});

export const terminalSessionList = createTool({
  name: 'terminal.session_list',
  description: 'List active terminal sessions',
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(_args, _context): Promise<ToolResult> {
    return {
      success: true,
      data: {
        sessions: [],
        note: 'Persistent terminal sessions require PTY integration (node-pty)',
      },
    };
  },
});

export const terminalSessionSend = createTool({
  name: 'terminal.session_send',
  description: 'Send input to a terminal session',
  schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      input: { type: 'string', description: 'Input to send' },
    },
    required: ['sessionId', 'input'],
    additionalProperties: false,
  },
  permissionLevel: 'SAFE_ACTION',
  async execute(args, _context): Promise<ToolResult> {
    const { sessionId, input } = args;

    return {
      success: false,
      error: 'Persistent terminal sessions require PTY integration (node-pty)',
      data: { sessionId, input },
    };
  },
});

export const terminalSessionClose = createTool({
  name: 'terminal.session_close',
  description: 'Close a terminal session',
  schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
    },
    required: ['sessionId'],
    additionalProperties: false,
  },
  permissionLevel: 'SAFE_ACTION',
  async execute(args, _context): Promise<ToolResult> {
    const { sessionId } = args;

    return {
      success: false,
      error: 'Persistent terminal sessions require PTY integration (node-pty)',
      data: { sessionId },
    };
  },
});

// Export all terminal tools
export const terminalTools = [
  terminalRun,
  terminalSessionCreate,
  terminalSessionList,
  terminalSessionSend,
  terminalSessionClose,
];