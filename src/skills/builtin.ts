/**
 * ORION System Skills
 * Built-in skills for core functionality
 */

import { BaseSkill, createSkillCommand } from './registry.js';
import type { SkillManifest, SkillCommand, ToolDefinition } from '@/types/index.js';
import { systemTools } from '@/tools/system/index.js';
import { filesystemTools } from '@/tools/filesystem/index.js';
import { browserTools } from '@/tools/browser/index.js';
import { terminalTools } from '@/tools/terminal/index.js';

// System Skill
export class SystemSkill extends BaseSkill {
  readonly manifest: SkillManifest = {
    metadata: {
      name: 'system',
      version: '1.0.0',
      description: 'Core system information and control',
      author: 'ORION Team',
      license: 'MIT',
      keywords: ['system', 'status', 'process', 'app', 'time'],
    },
    tools: systemTools.map((t) => t.name),
    commands: ['status', 'processes', 'time'],
    configSchema: {
      type: 'object',
      properties: {
        defaultProcessLimit: { type: 'number', default: 20 },
        defaultSortBy: { type: 'string', enum: ['cpu', 'memory', 'pid'], default: 'cpu' },
      },
    },
    defaultConfig: {
      defaultProcessLimit: 20,
      defaultSortBy: 'cpu',
    },
  };

  readonly tools = new Map<string, ToolDefinition>();
  readonly commands = new Map<string, SkillCommand>();

  constructor() {
    super();
    this.registerCommands();
  }

  private registerCommands(): void {
    this.commands.set('status', createSkillCommand(
      'status',
      'Show system status',
      'system.status',
      async () => {
        const result = await systemTools[0].execute({}, { 
          userId: 'user', 
          sessionId: 'session', 
          conversationId: 'conv', 
          workingDirectory: process.cwd(), 
          allowedPaths: [process.cwd()], 
          metadata: {} 
        });
        return { success: result.success, output: result.success ? JSON.stringify(result.data, null, 2) : result.error, data: result.data };
      }
    ));

    this.commands.set('processes', createSkillCommand(
      'processes',
      'List running processes',
      'system.processes [limit] [sortBy]',
      async (args) => {
        const limit = parseInt(args[0] || '20', 10);
        const sortBy = args[1] || 'cpu';
        const result = await systemTools[1].execute({ limit, sortBy }, { 
          userId: 'user', 
          sessionId: 'session', 
          conversationId: 'conv', 
          workingDirectory: process.cwd(), 
          allowedPaths: [process.cwd()], 
          metadata: {} 
        });
        return { success: result.success, output: result.success ? JSON.stringify(result.data, null, 2) : result.error, data: result.data };
      }
    ));

    this.commands.set('time', createSkillCommand(
      'time',
      'Show current time',
      'system.time [format] [timezone]',
      async (args) => {
        const format = (args[0] as 'iso' | 'locale' | 'unix') || 'iso';
        const timezone = args[1];
        const result = await systemTools[4].execute({ format, timezone }, { 
          userId: 'user', 
          sessionId: 'session', 
          conversationId: 'conv', 
          workingDirectory: process.cwd(), 
          allowedPaths: [process.cwd()], 
          metadata: {} 
        });
        return { success: result.success, output: result.success ? JSON.stringify(result.data, null, 2) : result.error, data: result.data };
      }
    ));
  }

  async onInitialize(): Promise<void> {
    console.log('[SystemSkill] Initialized');
  }
}

// Filesystem Skill
export class FilesystemSkill extends BaseSkill {
  readonly manifest: SkillManifest = {
    metadata: {
      name: 'filesystem',
      version: '1.0.0',
      description: 'File and directory operations',
      author: 'ORION Team',
      license: 'MIT',
      keywords: ['file', 'directory', 'read', 'write', 'search', 'list'],
    },
    tools: filesystemTools.map((t) => t.name),
    commands: ['list', 'read', 'write', 'search', 'info'],
    configSchema: {
      type: 'object',
      properties: {
        defaultListLimit: { type: 'number', default: 100 },
        maxFileSize: { type: 'number', default: 1048576 },
      },
    },
    defaultConfig: {
      defaultListLimit: 100,
      maxFileSize: 1048576,
    },
  };

  readonly tools = new Map<string, ToolDefinition>();
  readonly commands = new Map<string, SkillCommand>();

  constructor() {
    super();
    this.registerCommands();
  }

  private registerCommands(): void {
    this.commands.set('list', createSkillCommand(
      'list',
      'List files in a directory',
      'filesystem.list [path] [recursive] [pattern]',
      async (args) => {
        const result = await filesystemTools[0].execute(
          { path: args[0] || '.', recursive: args[1] === 'true', pattern: args[2] },
          { userId: 'user', sessionId: 'session', conversationId: 'conv', workingDirectory: process.cwd(), allowedPaths: [process.cwd()], metadata: {} }
        );
        return { success: result.success, output: result.success ? JSON.stringify(result.data, null, 2) : result.error, data: result.data };
      }
    ));

    this.commands.set('read', createSkillCommand(
      'read',
      'Read a file',
      'filesystem.read <path>',
      async (args) => {
        if (!args[0]) return { success: false, error: 'Path required' };
        const result = await filesystemTools[1].execute({ path: args[0] }, { 
          userId: 'user', sessionId: 'session', conversationId: 'conv', workingDirectory: process.cwd(), allowedPaths: [process.cwd()], metadata: {} 
        });
        return { success: result.success, output: result.success ? (result.data as { content?: string } | undefined)?.content : result.error, data: result.data };
      }
    ));

    this.commands.set('search', createSkillCommand(
      'search',
      'Search files',
      'filesystem.search [pattern] [content] [path]',
      async (args) => {
        const result = await filesystemTools[5].execute(
          { pattern: args[0], content: args[1], path: args[2] || '.' },
          { userId: 'user', sessionId: 'session', conversationId: 'conv', workingDirectory: process.cwd(), allowedPaths: [process.cwd()], metadata: {} }
        );
        return { success: result.success, output: result.success ? JSON.stringify(result.data, null, 2) : result.error, data: result.data };
      }
    ));
  }

  async onInitialize(): Promise<void> {
    console.log('[FilesystemSkill] Initialized');
  }
}

// Browser Skill
export class BrowserSkill extends BaseSkill {
  readonly manifest: SkillManifest = {
    metadata: {
      name: 'browser',
      version: '1.0.0',
      description: 'Web browsing and content extraction',
      author: 'ORION Team',
      license: 'MIT',
      keywords: ['web', 'browse', 'search', 'screenshot'],
    },
    tools: browserTools.map((t) => t.name),
    commands: ['open', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        defaultFormat: { type: 'string', enum: ['text', 'markdown', 'html', 'json'], default: 'markdown' },
        timeout: { type: 'number', default: 30000 },
      },
    },
    defaultConfig: {
      defaultFormat: 'markdown',
      timeout: 30000,
    },
  };

  readonly tools = new Map<string, ToolDefinition>();
  readonly commands = new Map<string, SkillCommand>();

  constructor() {
    super();
    this.registerCommands();
  }

  private registerCommands(): void {
    this.commands.set('open', createSkillCommand(
      'open',
      'Open a URL and extract content',
      'browser.open <url> [format]',
      async (args) => {
        if (!args[0]) return { success: false, error: 'URL required' };
        const result = await browserTools[0].execute(
          { url: args[0], format: (args[1] as any) || 'markdown' },
          { userId: 'user', sessionId: 'session', conversationId: 'conv', workingDirectory: process.cwd(), allowedPaths: [process.cwd()], metadata: {} }
        );
        return { success: result.success, output: result.success ? (result.data as { content?: string } | undefined)?.content : result.error, data: result.data };
      }
    ));

    this.commands.set('search', createSkillCommand(
      'search',
      'Search the web',
      'browser.search <query> [maxResults]',
      async (args) => {
        if (!args[0]) return { success: false, error: 'Query required' };
        const result = await browserTools[1].execute(
          { query: args[0], maxResults: parseInt(args[1] || '10', 10) },
          { userId: 'user', sessionId: 'session', conversationId: 'conv', workingDirectory: process.cwd(), allowedPaths: [process.cwd()], metadata: {} }
        );
        return { success: result.success, output: result.success ? JSON.stringify(result.data, null, 2) : result.error, data: result.data };
      }
    ));
  }

  async onInitialize(): Promise<void> {
    console.log('[BrowserSkill] Initialized');
  }
}

// Terminal Skill
export class TerminalSkill extends BaseSkill {
  readonly manifest: SkillManifest = {
    metadata: {
      name: 'terminal',
      version: '1.0.0',
      description: 'Terminal and shell operations',
      author: 'ORION Team',
      license: 'MIT',
      keywords: ['terminal', 'shell', 'command', 'session'],
    },
    tools: terminalTools.map((t) => t.name),
    commands: ['run', 'session'],
    configSchema: {
      type: 'object',
      properties: {
        defaultShell: { type: 'string', default: 'bash' },
        defaultTimeout: { type: 'number', default: 60000 },
      },
    },
    defaultConfig: {
      defaultShell: 'bash',
      defaultTimeout: 60000,
    },
  };

  readonly tools = new Map<string, ToolDefinition>();
  readonly commands = new Map<string, SkillCommand>();

  constructor() {
    super();
    this.registerCommands();
  }

  private registerCommands(): void {
    this.commands.set('run', createSkillCommand(
      'run',
      'Run a shell command',
      'terminal.run <command> [args...]',
      async (args) => {
        if (!args[0]) return { success: false, error: 'Command required' };
        const result = await terminalTools[0].execute(
          { command: args[0], args: args.slice(1) },
          { userId: 'user', sessionId: 'session', conversationId: 'conv', workingDirectory: process.cwd(), allowedPaths: [process.cwd()], metadata: {} }
        );
        return { success: result.success, output: result.success ? (result.data as { stdout?: string } | undefined)?.stdout : result.error, data: result.data };
      }
    ));
  }

  async onInitialize(): Promise<void> {
    console.log('[TerminalSkill] Initialized');
  }
}

// Export all built-in skills
export const builtinSkills = [
  SystemSkill,
  FilesystemSkill,
  BrowserSkill,
  TerminalSkill,
];