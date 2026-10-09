export const ALLOWED_COMMANDS = [
  'ls', 'cat', 'grep', 'find', 'git', 'npm', 'node', 'python', 'python3',
  'code', 'vim', 'nano', 'mkdir', 'touch', 'cp', 'mv', 'rm',
  'ps', 'top', 'htop', 'df', 'du', 'free', 'uname', 'whoami',
] as const;

export function isAllowedCommand(command: string): boolean {
  return !command.includes('/') && ALLOWED_COMMANDS.some((allowed) => allowed === command);
}
