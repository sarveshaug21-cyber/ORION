import { describe, expect, it } from 'vitest';
import { ToolPermissionManager } from './tool-permissions.js';

describe('ToolPermissionManager', () => {
  it('accepts a decision only from the requesting connection and session', async () => {
    const manager = new ToolPermissionManager(1000);
    const owner = {};
    const waiting = manager.request('tool-1', 'session-1', owner);

    expect(manager.respond('tool-1', 'session-2', owner, true)).toBe(false);
    expect(manager.respond('tool-1', 'session-1', {}, true)).toBe(false);
    expect(manager.respond('tool-1', 'session-1', owner, true)).toBe(true);
    await expect(waiting).resolves.toBe('approved');
  });

  it('resolves rejected, disconnected, and expired approvals without granting them', async () => {
    const manager = new ToolPermissionManager(10);
    const owner = {};
    const rejected = manager.request('rejected', 'session', owner);
    manager.respond('rejected', 'session', owner, false);
    await expect(rejected).resolves.toBe('denied');

    const disconnected = manager.request('disconnected', 'session', owner);
    manager.cancelOwner(owner);
    await expect(disconnected).resolves.toBe('disconnected');

    const expired = manager.request('expired', 'session', {});
    await expect(expired).resolves.toBe('expired');
  });
});
