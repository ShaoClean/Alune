import { useContext, useEffect, useRef } from 'react';
import { FeedbackContext } from '@alune/ui/internal';
import {
  fetchConnectedRepository,
  isBackgroundSyncConnected,
  observeOwners,
  readConnectedRepositoryStatus,
  type BackgroundPullTarget,
} from '../api/agent-workspace';
import { observeUiAgent } from '../api/ui-agent';
import { useBackgroundSyncStore } from '../stores/backgroundSyncStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { createBackgroundFetchScheduler } from './backgroundFetchScheduler';

export function useBackgroundFetch(
  onPull: (repositoryId: string, target: BackgroundPullTarget) => void,
) {
  const feedback = useContext(FeedbackContext);
  const pull = useRef(onPull);
  pull.current = onPull;
  useEffect(() => {
    const scheduler = createBackgroundFetchScheduler({
      fetch: (repo, signal) => fetchConnectedRepository(repo, signal),
      report(id, status) {
        useBackgroundSyncStore.setState(({ fetchStates }) => {
          if (!status && !fetchStates[id]) return { fetchStates };
          const next = { ...fetchStates };
          if (status) next[id] = status;
          else delete next[id];
          return { fetchStates: next };
        });
      },
      async completed(repo, result, signal) {
        if (!result.fetched) return;
        const update = result.update;
        if (update && feedback) {
          const id = `background-fetch:${repo.id}:${update.upstream}`;
          feedback.getState().publish({
            id,
            revision: update.upstreamHead,
            scope: 'background-sync',
            context: `${repo.name} · ${update.branch}`,
            title: '远程有新提交',
            description: `当前分支落后 ${update.upstream} ${update.behind} 个提交。`,
            type: 'info',
            mode: 'notification',
            autoOpen: false,
            kind: 'event',
            actionLabel: '拉取',
            onAction: () => pull.current(repo.id, update),
          });
        }
        await useRepositoryStore
          .getState()
          .refreshAfterBackgroundFetch(
            repo.id,
            (statusSignal) => readConnectedRepositoryStatus(repo, statusSignal, false),
            signal,
          );
      },
    });
    const reconcile = () => {
      const { backgroundSync } = useWorkspaceStore.getState();
      const { repositories } = useRepositoryStore.getState();
      const { statuses } = useConnectionStore.getState();
      scheduler.reconcile(backgroundSync, repositories, (repo) => {
        if (navigator.onLine === false) return '网络已断开，恢复后继续。';
        if (isBackgroundSyncConnected(repo)) {
          const status = repo.connectionId && statuses[repo.connectionId]?.status;
          if (!status || !['disconnected', 'error', 'connecting'].includes(status)) return;
        }
        return repo.connectionId
          ? 'SSH 连接未就绪，恢复后继续。'
          : 'Agent 连接未就绪，恢复后继续。';
      });
    };
    const dispose = [
      useWorkspaceStore.subscribe((state, previous) => {
        if (state.backgroundSync !== previous.backgroundSync) reconcile();
      }),
      useRepositoryStore.subscribe((state, previous) => {
        if (state.repositories !== previous.repositories) reconcile();
      }),
      useConnectionStore.subscribe((state, previous) => {
        if (state.statuses !== previous.statuses) reconcile();
      }),
      observeOwners(reconcile),
      observeUiAgent(reconcile),
    ];
    window.addEventListener('online', reconcile);
    window.addEventListener('offline', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    reconcile();
    return () => {
      for (const off of dispose) off();
      window.removeEventListener('online', reconcile);
      window.removeEventListener('offline', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      scheduler.stop();
    };
  }, [feedback]);
}
