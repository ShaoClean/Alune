import type { RemoteInfo } from '@alune/domain';
import type { RepositoryResource } from '@alune/protocol';
import type { StagedRepository } from '../modules/ai/service';

/** Trusted host-side bridge for P6. It receives a catalog row, never a caller
 * supplied path, platform token, provider configuration, URL or Git command. */
export interface LegacyRepositoryReads {
  remotes(repo: RepositoryResource, signal: AbortSignal): Promise<RemoteInfo[]>;
  branch(
    repo: RepositoryResource,
    branch: string | undefined,
    signal: AbortSignal,
  ): Promise<{ name: string; sha: string }>;
  openStaged(repo: RepositoryResource, signal: AbortSignal): Promise<StagedRepository>;
}
