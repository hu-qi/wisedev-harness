import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

export type ShellMode = 'auto' | 'sh' | 'cmd' | 'powershell';

export interface ShellRunOptions {
  cwd: string;
  timeout: number;
  env?: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'pipe';
}

export interface ResolvedShell {
  mode: Exclude<ShellMode, 'auto'>;
  executable: string;
  argsPrefix: string[];
}

export function resolveShell(mode: ShellMode = 'auto', platform = process.platform, env = process.env): ResolvedShell {
  const effective = mode === 'auto' ? (platform === 'win32' ? 'cmd' : 'sh') : mode;
  if (effective === 'sh') return { mode: 'sh', executable: env.SHELL || 'sh', argsPrefix: ['-lc'] };
  if (effective === 'cmd') return { mode: 'cmd', executable: env.ComSpec || env.COMSPEC || 'cmd.exe', argsPrefix: ['/d', '/s', '/c'] };
  return { mode: 'powershell', executable: env.POWERSHELL_EXE || 'powershell.exe', argsPrefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] };
}

export function runShellCommand(command: string, mode: ShellMode, options: ShellRunOptions): SpawnSyncReturns<string> {
  const shell = resolveShell(mode);
  return spawnSync(shell.executable, [...shell.argsPrefix, command], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout,
    env: options.env ?? process.env,
    stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe']
  }) as SpawnSyncReturns<string>;
}
