import { useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentUiAgent, observeUiAgent } from '../api/ui-agent';
import { FeedbackContext } from '../components/feedback-context';
import { createPullRequestActivityPoller, pullRequestActivityScope } from './pullRequestActivity';

export function usePullRequestActivity(
  enabled: boolean,
  intervalMinutes: number,
  excludedRepositoryIds: readonly string[],
) {
  const client = useSyncExternalStore(observeUiAgent, currentUiAgent);
  const store = useContext(FeedbackContext);
  const goTo = useNavigate();
  const navigate = useRef(goTo);
  navigate.current = goTo;
  const poller = useRef<ReturnType<typeof createPullRequestActivityPoller> | null>(null);
  const excludedKey = JSON.stringify([...new Set(excludedRepositoryIds)].sort());
  useEffect(() => {
    if (!store) return;
    const retainScopes = (scopes: ReadonlySet<string>) => {
      for (const entry of store.getState().entries) {
        if (entry.scope.startsWith(pullRequestActivityScope) && !scopes.has(entry.scope))
          store.getState().dismiss(entry.id);
      }
    };
    const cancelOnTokenChange = () => {
      // Notification titles can come from private repositories. Retire them
      // as soon as the app observes a change to its credential associations.
      retainScopes(new Set());
      active?.abort();
      if (enabled) schedule(0);
    };
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let checkAgain = false;
    const schedule = (delay: number) => {
      if (stopped || !navigator.onLine) return;
      clearTimeout(timer);
      if (active) {
        checkAgain = true;
        return;
      }
      timer = setTimeout(() => void check(), delay);
    };
    const excluded = new Set<string>(JSON.parse(excludedKey));
    const check = async () => {
      if (client?.state !== 'ready' || !client.initialized || !poller.current) return;
      const startedAt = Date.now();
      active = new AbortController();
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(75_000)]);
      try {
        await poller.current(
          client,
          client.initialized.agentId,
          excluded,
          signal,
          (notice) => {
            if (signal.aborted) return;
            store.getState().publish({
              id: notice.id,
              revision: notice.id,
              scope: notice.scope,
              context: 'PR/MR 动态',
              title: notice.title,
              description: notice.description,
              type: 'info',
              mode: 'notification',
              autoOpen: false,
              kind: 'event',
              actionLabel: '查看 PR/MR',
              onAction: () => {
                void navigate.current(notice.path);
              },
            });
          },
          retainScopes,
        );
      } catch {
        // The next check can reuse successful observations and all errors are silent.
      } finally {
        active = undefined;
        const delay = checkAgain
          ? 0
          : Math.max(0, intervalMinutes * 60_000 - (Date.now() - startedAt));
        checkAgain = false;
        schedule(delay);
      }
    };
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      active?.abort();
    };
    const pause = () => {
      clearTimeout(timer);
      active?.abort();
    };
    const resume = () => {
      if (enabled) schedule(0);
    };
    window.addEventListener('offline', pause);
    window.addEventListener('online', resume);
    const offClose = client?.onClose(stop);
    const offEvent = client?.onEvent((event) => {
      if (event.type === 'accounts.tokens.changed' || event.type === 'events.resync-required')
        cancelOnTokenChange();
    });
    if (enabled) {
      poller.current ??= createPullRequestActivityPoller();
      schedule(0);
    } else poller.current = null;
    return () => {
      stop();
      window.removeEventListener('offline', pause);
      window.removeEventListener('online', resume);
      offClose?.();
      offEvent?.();
    };
  }, [client, enabled, excludedKey, intervalMinutes, store]);
}
