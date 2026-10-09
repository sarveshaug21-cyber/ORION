import { isAbsolute, relative, resolve, sep } from 'path';
import { realpath } from 'fs/promises';

export function isPathWithinAllowedPaths(path: string, allowedPaths: string[]): boolean {
  const candidate = resolve(path);
  return allowedPaths.some((allowedPath) => {
    const relativePath = relative(resolve(allowedPath), candidate);
    return relativePath === '' ||
      (relativePath !== '..' &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath));
  });
}

export async function resolveAllowedWorkingDirectory(
  path: string,
  allowedPaths: string[]
): Promise<string> {
  const [canonicalPath, ...canonicalAllowedPaths] = await Promise.all([
    realpath(path),
    ...allowedPaths.map((allowedPath) => realpath(allowedPath)),
  ]);
  if (!isPathWithinAllowedPaths(canonicalPath, canonicalAllowedPaths)) {
    throw new Error(`Working directory "${path}" is not in allowed paths.`);
  }
  return canonicalPath;
}
