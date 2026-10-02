import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import type { TerminalSession } from '@alune/shared';

type Entry = { info: TerminalSession; close: () => void };
export type TerminalScope = { repositoryId?: string; connectionId?: string };

// Kept separate from transports so registry deletion cannot depend on the
// TerminalService -> RepositoryService -> ConnectionService dependency chain.
@Injectable()
export class TerminalRegistry {
  enabled = false;
  desktop = false;
  readonly entries = new Map<string, Entry>();
  private removingRepositories = new Set<string>();

  assertAvailable(repositoryId: string) {
    if (this.removingRepositories.has(repositoryId))
      throw new ConflictException('正在移除此 Worktree，请稍候。');
  }

  async withoutTerminals<T>(
    repositoryIds: string[],
    operation: () => Promise<T>,
  ) {
    for (const repositoryId of repositoryIds) {
      this.assertAvailable(repositoryId);
      this.assertRemovable({ repositoryId });
    }
    repositoryIds.forEach((id) => this.removingRepositories.add(id));
    try {
      return await operation();
    } finally {
      repositoryIds.forEach((id) => this.removingRepositories.delete(id));
    }
  }

  matching(scope: TerminalScope) {
    return [...this.entries.values()].filter(({ info }) =>
      scope.repositoryId
        ? info.repositoryId === scope.repositoryId
        : scope.connectionId
          ? info.connectionId === scope.connectionId
          : true,
    );
  }

  impact(scope: TerminalScope) {
    return this.matching(scope)
      .filter(({ info }) => ['connecting', 'running'].includes(info.state))
      .map(({ info }) => ({ ...info }));
  }

  assertRemovable(scope: TerminalScope, confirmed?: unknown) {
    const active = this.impact(scope);
    if (
      active.some(
        ({ id }) => !Array.isArray(confirmed) || !confirmed.includes(id),
      )
    ) {
      throw new ConflictException({
        message: `仍有 ${active.length} 个终端会话，请确认关闭后再移除。`,
        code: 'TERMINAL_CONFIRM_REQUIRED',
        sessions: active,
      });
    }
  }

  remove(scope: TerminalScope, confirmed?: unknown) {
    this.assertRemovable(scope, confirmed);
    for (const entry of this.matching(scope)) entry.close();
  }
}

@Global()
@Module({ providers: [TerminalRegistry], exports: [TerminalRegistry] })
export class TerminalRegistryModule {}
