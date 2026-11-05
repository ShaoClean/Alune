import type { LegacyRepositoryReads } from '@alune/agent';
import type { RepositoryResource } from '@alune/protocol';
import { GitCommands, StagedChanges } from '@alune/ssh-client';
import { pullRequestBranch } from '@alune/agent/git/pull-request-branch';
import { ConflictException } from '@nestjs/common';
import type { ConnectionService } from '../connection/connection.service';
import type { RepositoryService } from './repository.service';

// Only an embedded local host can install this bridge. Never trust a stale
// import if the user has since removed or rebound the original registration.
export function legacyCollaborationReads(
  repositories: RepositoryService,
  connections: ConnectionService,
): LegacyRepositoryReads {
  async function acquire(repo: RepositoryResource, signal: AbortSignal) {
    const verify = async () => {
      const record = await repositories.get(repo.id);
      if (
        repo.source !== 'ssh' ||
        !repo.connectionId ||
        record.source !== 'ssh' ||
        record.connectionId !== repo.connectionId ||
        record.path !== repo.path
      )
        throw new ConflictException('远程仓库登记已变化，请重新核对来源。');
      signal.throwIfAborted();
    };
    await verify();
    const conn = await connections.ensureConnected(repo.connectionId!);
    await verify();
    return { conn, release: conn.holdTask() };
  }
  return {
    async remotes(repo, signal) {
      const lease = await acquire(repo, signal);
      try {
        return await new GitCommands(lease.conn).remoteList(repo.path, signal);
      } finally {
        lease.release();
      }
    },
    async branch(repo, name, signal) {
      const lease = await acquire(repo, signal);
      try {
        return await pullRequestBranch(lease.conn, repo.path, name, signal);
      } finally {
        lease.release();
      }
    },
    async openStaged(repo, signal) {
      const lease = await acquire(repo, signal);
      return {
        staged: new StagedChanges(lease.conn, repo.path),
        release: lease.release,
      };
    },
  };
}
