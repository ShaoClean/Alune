import type { SSHConnection, CommandResult } from './connection-manager';
import { gitFileCommand } from './git-shell';

export type CommandOptions = {
  onStderr?: (data: string) => void;
  onStdout?: (data: string) => void;
  stdin?: string | Buffer;
  maxOutputBytes?: number;
  strictUtf8?: boolean;
  binary?: boolean;
  environment?: Record<string, string>;
};

// Git and file parsing are shared; only execution and file transport differ.
export type RepositoryTransport = Pick<SSHConnection, 'execCommand' | 'withSftp'> & {
  signal?: AbortSignal;
  hasAnyPath?: (paths: string[]) => Promise<boolean>;
  execGit?: (
    path: string,
    args: string[],
    signal?: AbortSignal,
    options?: CommandOptions,
  ) => Promise<CommandResult>;
};

export async function runGit(
  connection: RepositoryTransport,
  path: string,
  args: string[],
  signal?: AbortSignal,
  options?: CommandOptions,
): Promise<CommandResult> {
  const combined =
    signal && connection.signal
      ? AbortSignal.any([signal, connection.signal])
      : (signal ?? connection.signal);
  combined?.throwIfAborted();
  // Stash constructs its own pathspecs when cleaning untracked files. A globally
  // inherited literal-pathspecs flag makes Git treat those internal patterns as
  // filenames and silently leave the files behind. No caller-supplied paths are
  // accepted by our stash operations, so allow Git's internal pathspec handling.
  // git-lfs also builds internal wildcard pathspecs while checking out fetched objects.
  if (args[0] === 'stash' || args[0] === 'lfs') args = ['--no-literal-pathspecs', ...args];
  const execute = (argv: string[]) =>
    connection.execGit
      ? connection.execGit(path, argv, combined, options)
      : connection.execCommand(
          gitFileCommand(path, argv, options?.environment),
          undefined,
          combined,
          options,
        );
  const result = await execute(args);
  let verb = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c') {
      i++;
      continue;
    }
    if (args[i].startsWith('-')) continue;
    verb = args[i];
    break;
  }
  // A previously installed required filter must not prevent opening a repository
  // after git-lfs is removed. Retry only read-only status/diff; never stage or
  // commit raw hydrated content as a substitute for an LFS pointer.
  if (
    result.exitCode !== 0 &&
    ['status', 'diff'].includes(verb) &&
    /git-lfs[^\n]*(?:not found|not recognized|No such file)/i.test(result.stderr)
  ) {
    return execute([
      '-c',
      'filter.lfs.required=false',
      '-c',
      'filter.lfs.process=',
      '-c',
      'filter.lfs.clean=',
      '-c',
      'filter.lfs.smudge=',
      ...args,
    ]);
  }
  return result;
}
