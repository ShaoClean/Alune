import type { TerminalSession } from '@alune/domain';

type Entry = { info: TerminalSession; close: () => void };
export type TerminalScope = { repositoryId?: string; connectionId?: string };

// Kept separate from transports so registry deletion cannot depend on the
// TerminalService -> RepositoryService -> ConnectionService dependency chain.
export class TerminalRegistry {
  constructor(private conflict: (message: string, sessions?: TerminalSession[]) => Error) {}
  enabled = false;
  desktop = false;
  readonly entries = new Map<string, Entry>();
  private removingRepositories = new Set<string>();

  assertAvailable(repositoryId: string) {
    if (this.removingRepositories.has(repositoryId))
      throw this.conflict('正在移除此 Worktree，请稍候。');
  }

  async withoutTerminals<T>(repositoryIds: string[], operation: () => Promise<T>) {
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
    if (active.some(({ id }) => !Array.isArray(confirmed) || !confirmed.includes(id))) {
      throw this.conflict(`仍有 ${active.length} 个终端会话，请确认关闭后再移除。`, active);
    }
  }

  remove(scope: TerminalScope, confirmed?: unknown) {
    this.assertRemovable(scope, confirmed);
    for (const entry of this.matching(scope)) entry.close();
  }
}
