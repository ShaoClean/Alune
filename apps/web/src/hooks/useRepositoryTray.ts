import { useEffect } from 'react';
import type { Repository, ConnectionStatusInfo } from '@alune/domain';
import { readConnectedHead } from '../api/agent-workspace';
import { useRepositoryStore, type RepositoryStatusEntry } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function useRepositoryTray(
  repositories: Repository[],
  labels: Map<string, string>,
  connections: { id: string; name: string }[],
  statuses: Record<string, ConnectionStatusInfo>,
  entries: Record<string, RepositoryStatusEntry>,
  select: (id: string) => void,
) {
  const bridge = window.aluneTray;
  const activeId = useWorkspaceStore((state) => state.repositorySession.activeId);
  useEffect(() => {
    if (!bridge) return;
    return bridge.onSelect((id) => {
      if (useRepositoryStore.getState().openRepositories.some((tab) => tab.id === id)) select(id);
    });
  }, [bridge, select]);
  useEffect(() => {
    if (!bridge) return;
    let pending: AbortController | undefined;
    const offRead = bridge.onReadHead(async (request) => {
      pending?.abort();
      const tab = useRepositoryStore
        .getState()
        .openRepositories.find((row) => row.id === request.id);
      if (!tab || useWorkspaceStore.getState().repositorySession.activeId !== request.id) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const head = await readConnectedHead(tab.id, tab.connectionId, controller.signal);
        if (controller.signal.aborted) return;
        if (!head) {
          bridge.replyHead({ ...request, state: tab.source === 'ssh' ? 'offline' : 'cached' });
          return;
        }
        const label =
          head.kind === 'detached'
            ? '游离 HEAD · ' + head.oid.slice(0, 8)
            : head.name + (head.kind === 'unborn' ? '（尚无提交）' : '');
        bridge.replyHead({ ...request, state: 'ready', label });
      } catch {
        if (!controller.signal.aborted) bridge.replyHead({ ...request, state: 'cached' });
      }
    });
    return () => {
      offRead();
      pending?.abort();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    const tabs = repositories.map((repo) => {
      const entry = entries[repo.id];
      const status = entry?.data;
      const connection = repo.connectionId ? statuses[repo.connectionId] : undefined;
      const suffix = [
        labels.get(repo.id),
        repo.connectionId && (connections.find((c) => c.id === repo.connectionId)?.name || 'SSH'),
      ]
        .filter(Boolean)
        .join(' · ');
      const name = status?.branch ?? repo.currentBranch;
      const branch =
        status && !status.unborn && (!name || name === 'HEAD')
          ? '游离 HEAD'
          : (name || '') + (status?.unborn ? '（尚无提交）' : '');
      return {
        id: repo.id,
        label: repo.name + (suffix ? '（' + suffix + '）' : ''),
        branch,
        revision: entry?.updatedAt,
        offline: connection?.status === 'disconnected' || connection?.status === 'error',
        stale: !entry?.data || Boolean(entry.stale) || entry.phase === 'error',
      };
    });
    bridge.publish({ activeId, tabs });
  }, [bridge, repositories, activeId, labels, connections, statuses, entries]);
}
