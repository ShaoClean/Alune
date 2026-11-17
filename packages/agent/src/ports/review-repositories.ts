import type { RemoteInfo, Repository, ResourceRef } from '@alune/domain';
export interface ReviewRepositories {
  list(): Promise<Array<Repository & { resource?: ResourceRef }>>;
  getRemotes(id: string, signal: AbortSignal): Promise<RemoteInfo[]>;
  pullRequestBranch(
    id: string,
    branch?: string,
    signal?: AbortSignal,
  ): Promise<{ name: string; sha: string }>;
}
export interface ReviewConnections {
  list():
    | PromiseLike<Array<{ id: string; name?: string; host: string }>>
    | Array<{ id: string; name?: string; host: string }>;
}
