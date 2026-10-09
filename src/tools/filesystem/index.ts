/**
 * ORION Filesystem Tools
 * Tools for file and directory operations
 */

import type { ToolExecutionContext, ToolResult } from '../../types/index.js';
import { createTool } from '../registry.js';
import { createOrionError } from '../../types/index.js';
import { promises as fs } from 'fs';
import { join, resolve, relative, dirname, basename, extname } from 'path';
import { glob } from 'glob';
import { isPathWithinAllowedPaths } from '../path-policy.js';

async function canonicalizePath(path: string): Promise<string> {
  let candidate = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return resolve(await fs.realpath(candidate), ...missingSegments.reverse());
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

async function sanitizePath(path: string, context: ToolExecutionContext): Promise<string> {
  const normalized = resolve(context.workingDirectory, path);
  const [canonicalPath, ...canonicalAllowedPaths] = await Promise.all([
    canonicalizePath(normalized),
    ...context.allowedPaths.map(canonicalizePath),
  ]);
  if (!isPathWithinAllowedPaths(canonicalPath, canonicalAllowedPaths)) {
    throw createOrionError(
      'PATH_NOT_ALLOWED',
      `Path "${path}" is not within allowed directories`,
      'Access denied: path outside allowed directories',
      { recoverable: false }
    );
  }
  return normalized;
}

export const filesystemList = createTool({
  name: 'filesystem.list',
  description: 'List files and directories in a given path',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (relative to working directory)', default: '.' },
      recursive: { type: 'boolean', description: 'List recursively', default: false },
      includeHidden: { type: 'boolean', description: 'Include hidden files', default: false },
      pattern: { type: 'string', description: 'Glob pattern to filter results' },
    },
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args: { path?: string; recursive?: boolean; includeHidden?: boolean; pattern?: string }, context): Promise<ToolResult> {
    const { path = '.', recursive = false, includeHidden = false, pattern } = args;

    try {
      const targetPath = await sanitizePath(path as string, context);

      let files: string[];
      if (pattern) {
        files = await glob(pattern, {
          cwd: targetPath,
          nodir: false,
          dot: includeHidden,
          absolute: true,
        });
      } else if (recursive) {
        files = await glob('**/*', {
          cwd: targetPath,
          nodir: false,
          dot: includeHidden,
          absolute: true,
        });
      } else {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        files = entries
          .filter((e) => includeHidden || !e.name.startsWith('.'))
          .map((e) => join(targetPath, e.name));
      }

      const results = await Promise.all(
        files.map(async (file) => {
          const safeFile = await sanitizePath(file, context);
          const stat = await fs.stat(safeFile);
          const relPath = relative(context.workingDirectory, safeFile);
          return {
            path: relPath,
            name: basename(safeFile),
            type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
            size: stat.size,
            modified: stat.mtime.toISOString(),
            extension: stat.isFile() ? extname(safeFile).slice(1) : undefined,
          };
        })
      );

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list files',
      };
    }
  },
});

export const filesystemRead = createTool({
  name: 'filesystem.read',
  description: 'Read the contents of a file',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read (relative to working directory)' },
      encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'File encoding', default: 'utf-8' },
      offset: { type: 'number', description: 'Byte offset to start reading from', default: 0 },
      limit: { type: 'number', description: 'Maximum bytes to read', default: 1048576 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args: { path: string; encoding?: 'utf-8' | 'base64'; offset?: number; limit?: number }, context): Promise<ToolResult> {
    const { path, encoding = 'utf-8', offset = 0, limit = 1048576 } = args;

    try {
      const targetPath = await sanitizePath(path as string, context);

      const stat = await fs.stat(targetPath);
      if (!stat.isFile()) {
        return { success: false, error: 'Path is not a file' };
      }

      if (stat.size > limit + offset) {
        return { success: false, error: `File too large (${stat.size} bytes). Max readable: ${limit} bytes` };
      }

      const buffer = Buffer.alloc(Math.min(limit, stat.size - offset));
      const handle = await fs.open(targetPath, 'r');
      await handle.read(buffer, 0, buffer.length, offset);
      await handle.close();

      const content = encoding === 'base64' ? buffer.toString('base64') : buffer.toString('utf-8');

      return {
        success: true,
        data: {
          path: relative(context.workingDirectory, targetPath),
          content,
          size: stat.size,
          encoding,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file',
      };
    }
  },
});

export const filesystemWrite = createTool({
  name: 'filesystem.write',
  description: 'Write content to a file (creates or overwrites)',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write (relative to working directory)' },
      content: { type: 'string', description: 'Content to write' },
      encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Content encoding', default: 'utf-8' },
      createDirs: { type: 'boolean', description: 'Create parent directories if they do not exist', default: true },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  permissionLevel: 'REQUIRES_CONFIRMATION',
  async execute(args: { path: string; content: string; encoding?: 'utf-8' | 'base64'; createDirs?: boolean }, context): Promise<ToolResult> {
    const { path, content, encoding = 'utf-8', createDirs = true } = args;

    try {
      const targetPath = await sanitizePath(path as string, context);

      if (createDirs) {
        await fs.mkdir(dirname(targetPath), { recursive: true });
      }

      const buffer = encoding === 'base64' ? Buffer.from(content as string, 'base64') : Buffer.from(content as string, 'utf-8');
      await fs.writeFile(targetPath, buffer);

      return {
        success: true,
        data: {
          path: relative(context.workingDirectory, targetPath),
          bytesWritten: buffer.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write file',
      };
    }
  },
});

export const filesystemDelete = createTool({
  name: 'filesystem.delete',
  description: 'Delete a file or directory',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to delete (relative to working directory)' },
      recursive: { type: 'boolean', description: 'Delete directories recursively', default: false },
    },
    required: ['path'],
    additionalProperties: false,
  },
  permissionLevel: 'REQUIRES_CONFIRMATION',
  async execute(args: { path: string; recursive?: boolean }, context): Promise<ToolResult> {
    const { path, recursive = false } = args;

    try {
      const targetPath = await sanitizePath(path as string, context);

      const stat = await fs.stat(targetPath);
      if (stat.isDirectory() && !recursive) {
        return { success: false, error: 'Directory not empty. Use recursive: true to delete non-empty directories' };
      }

      await fs.rm(targetPath, { recursive, force: true });

      return {
        success: true,
        data: { path: relative(context.workingDirectory, targetPath) },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete',
      };
    }
  },
});

export const filesystemMove = createTool({
  name: 'filesystem.move',
  description: 'Move or rename a file or directory',
  schema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source path (relative to working directory)' },
      to: { type: 'string', description: 'Destination path (relative to working directory)' },
      overwrite: { type: 'boolean', description: 'Overwrite destination if it exists', default: false },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  permissionLevel: 'REQUIRES_CONFIRMATION',
  async execute(args: { from: string; to: string; overwrite?: boolean }, context): Promise<ToolResult> {
    const { from, to, overwrite = false } = args;

    try {
      const sourcePath = await sanitizePath(from as string, context);
      const destPath = await sanitizePath(to as string, context);

      if (!overwrite) {
        try {
          await fs.access(destPath);
          return { success: false, error: 'Destination already exists. Use overwrite: true to replace' };
        } catch {
          // Destination doesn't exist, proceed
        }
      }

      await fs.mkdir(dirname(destPath), { recursive: true });
      await fs.rename(sourcePath, destPath);

      return {
        success: true,
        data: {
          from: relative(context.workingDirectory, sourcePath),
          to: relative(context.workingDirectory, destPath),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to move',
      };
    }
  },
});

export const filesystemSearch = createTool({
  name: 'filesystem.search',
  description: 'Search for files matching a pattern or containing text',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match file paths' },
      content: { type: 'string', description: 'Text content to search for within files' },
      path: { type: 'string', description: 'Base directory to search in (relative to working directory)', default: '.' },
      filePattern: { type: 'string', description: 'Glob pattern to filter which files to search content in', default: '**/*' },
      caseSensitive: { type: 'boolean', description: 'Case sensitive search', default: false },
      maxResults: { type: 'number', description: 'Maximum results to return', default: 100 },
    },
    required: [],
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args: { pattern?: string; content?: string; path?: string; filePattern?: string; caseSensitive?: boolean; maxResults?: number }, context): Promise<ToolResult> {
    const { pattern, content, path = '.', filePattern = '**/*', caseSensitive = false, maxResults = 100 } = args;

    try {
      const targetPath = await sanitizePath(path as string, context);

      let files: string[];

      if (pattern) {
        files = await glob(pattern, { cwd: targetPath, absolute: true, nodir: true });
      } else {
        files = await glob(filePattern, { cwd: targetPath, absolute: true, nodir: true });
      }

      const results: Array<{ path: string; matches: Array<{ line: number; content: string }> }> = [];

      for (const file of files) {
        if (results.length >= maxResults) break;

        try {
          const safeFile = await sanitizePath(file, context);
          const stat = await fs.stat(safeFile);
          if (stat.size > 1048576) continue; // Skip files > 1MB

          const fileContent = await fs.readFile(safeFile, 'utf-8');
          const lines = fileContent.split('\n');
          const matches: Array<{ line: number; content: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = caseSensitive
              ? line.includes(content as string)
              : line.toLowerCase().includes((content as string).toLowerCase());

            if (match) {
              matches.push({ line: i + 1, content: line.trim() });
              if (matches.length >= 10) break; // Limit matches per file
            }
          }

          if (matches.length > 0 || (!content && pattern)) {
            results.push({
              path: relative(context.workingDirectory, safeFile),
              matches,
            });
          }
        } catch {
          // Skip unreadable files
        }
      }

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search',
      };
    }
  },
});

export const filesystemInfo = createTool({
  name: 'filesystem.info',
  description: 'Get detailed information about a file or directory',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to inspect (relative to working directory)' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  permissionLevel: 'READ_ONLY',
  async execute(args, context): Promise<ToolResult> {
    const { path } = args;

    try {
      const targetPath = await sanitizePath(path as string, context);

      const stat = await fs.stat(targetPath);
      const relPath = relative(context.workingDirectory, targetPath);

      const info: Record<string, unknown> = {
        path: relPath,
        name: basename(targetPath),
        type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
        size: stat.size,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        accessed: stat.atime.toISOString(),
        permissions: stat.mode.toString(8).slice(-3),
        isReadable: true,
        isWritable: true,
      };

      try {
        await fs.access(targetPath, fs.constants.R_OK);
      } catch {
        info.isReadable = false;
      }

      try {
        await fs.access(targetPath, fs.constants.W_OK);
      } catch {
        info.isWritable = false;
      }

      if (stat.isFile()) {
        info.extension = extname(targetPath).slice(1) || 'none';
      }

      return { success: true, data: info };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get file info',
      };
    }
  },
});

// Export all filesystem tools
export const filesystemTools = [
  filesystemList,
  filesystemRead,
  filesystemWrite,
  filesystemDelete,
  filesystemMove,
  filesystemSearch,
  filesystemInfo,
];