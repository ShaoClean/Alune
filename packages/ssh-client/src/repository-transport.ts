import type { SSHConnection } from './connection-manager';

import type { GitProcessPort } from '@alune/agent/process';
export type { CommandOptions } from '@alune/agent/process';

// Git and file parsing are shared; only execution and file transport differ.
export type RepositoryTransport = Pick<SSHConnection, 'execCommand' | 'withSftp'> & {
  signal?: AbortSignal;
  hasAnyPath?: (paths: string[]) => Promise<boolean>;
  execGit?: GitProcessPort['execGit'];
};

export { runGit } from '@alune/agent/git/repository-transport';
