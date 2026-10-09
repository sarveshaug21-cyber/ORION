import { describe, expect, it } from 'vitest';
import { isAllowedCommand } from './command-policy.js';
import { isPathWithinAllowedPaths } from './path-policy.js';

describe('tool execution policies', () => {
  it('checks path ancestry on segment boundaries', () => {
    expect(isPathWithinAllowedPaths('/tmp/orion/project/file.txt', ['/tmp/orion'])).toBe(true);
    expect(isPathWithinAllowedPaths('/tmp/orion-malicious/file.txt', ['/tmp/orion'])).toBe(false);
    expect(isPathWithinAllowedPaths('/tmp/elsewhere', ['/tmp/orion'])).toBe(false);
  });

  it('only allows bare commands from the explicit execution allowlist', () => {
    expect(isAllowedCommand('git')).toBe(true);
    expect(isAllowedCommand('sh')).toBe(false);
    expect(isAllowedCommand('/tmp/git')).toBe(false);
  });
});
