import type { SSHConnection, CommandResult } from './connection-manager';
import { gitFileCommand } from './git-shell';

export type CommandOptions = { maxOutputBytes?: number; strictUtf8?: boolean; binary?: boolean };

// Git and file parsing are shared; only execution and file transport differ.
export type RepositoryTransport = Pick<SSHConnection, 'execCommand' | 'withSftp'> & {
  signal?: AbortSignal;
  execGit?: (
    path: string,
    args: string[],
    signal?: AbortSignal,
    options?: CommandOptions,
  ) => Promise<CommandResult>;
};

export function runGit(
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
  if (args[0] === 'stash') args = ['--no-literal-pathspecs', ...args];
  if (connection.execGit) return connection.execGit(path, args, combined, options);
  return connection.execCommand(gitFileCommand(path, args), undefined, combined, options);
}
