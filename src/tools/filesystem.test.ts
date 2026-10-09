import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { filesystemRead } from './filesystem/index.js';
import type { ToolExecutionContext } from '../types/index.js';
import { resolveAllowedWorkingDirectory } from './path-policy.js';

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('filesystem path authorization', () => {
  it('allows files inside a permitted directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orion-fs-'));
    testDirectories.push(parent);
    const allowedDirectory = join(parent, 'allowed');
    await mkdir(allowedDirectory);
    const filePath = join(allowedDirectory, 'note.txt');
    await writeFile(filePath, 'private note');

    const context: ToolExecutionContext = {
      userId: 'user',
      sessionId: 'session',
      conversationId: 'conversation',
      workingDirectory: allowedDirectory,
      allowedPaths: [allowedDirectory],
      metadata: {},
    };

    await expect(filesystemRead.execute({ path: 'note.txt' }, context)).resolves.toMatchObject({
      success: true,
      data: { content: 'private note' },
    });
  });

  it('rejects symlinks that resolve outside permitted directories', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orion-fs-'));
    testDirectories.push(parent);
    const allowedDirectory = join(parent, 'allowed');
    const privateDirectory = join(parent, 'private');
    await mkdir(allowedDirectory);
    await mkdir(privateDirectory);
    const outsideAlias = join(parent, 'outside-alias');
    await symlink(privateDirectory, outsideAlias);
    await writeFile(join(privateDirectory, 'secret.txt'), 'not for ORION');
    await symlink(join(privateDirectory, 'secret.txt'), join(allowedDirectory, 'linked.txt'));

    const context: ToolExecutionContext = {
      userId: 'user',
      sessionId: 'session',
      conversationId: 'conversation',
      workingDirectory: allowedDirectory,
      allowedPaths: [allowedDirectory],
      metadata: {},
    };

    await expect(filesystemRead.execute({ path: 'linked.txt' }, context)).resolves.toMatchObject({
      success: false,
    });
    await expect(
      resolveAllowedWorkingDirectory(outsideAlias, [allowedDirectory])
    ).rejects.toThrow('not in allowed paths');
    await expect(readFile(join(privateDirectory, 'secret.txt'), 'utf-8')).resolves.toBe('not for ORION');
  });
});
