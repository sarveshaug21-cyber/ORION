/**
 * ORION Tools Module
 * Exports all tools and the registry
 */

export * from './registry.js';
export * from './system/index.js';
export * from './filesystem/index.js';
export * from './browser/index.js';
export * from './terminal/index.js';

import { toolRegistry } from './registry.js';
import { systemTools } from './system/index.js';
import { filesystemTools } from './filesystem/index.js';
import { browserTools } from './browser/index.js';
import { terminalTools } from './terminal/index.js';

// Register all built-in tools
export function registerBuiltinTools(): void {
  for (const tool of [...systemTools, ...filesystemTools, ...browserTools, ...terminalTools]) {
    toolRegistry.register(tool);
  }
}

export function getBuiltinTools(): typeof systemTools[0][] {
  return [...systemTools, ...filesystemTools, ...browserTools, ...terminalTools];
}