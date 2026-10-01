import { useContext, useEffect, useMemo } from 'react';
import { FeedbackContext } from './feedback-context';
import { ScopeContext } from './FeedbackNotice';
import type { FeedbackEvent } from '../stores/feedbackStore';

let sequence = 0;
/** Operation feedback with source ownership, ordered delivery and stale callback protection. */
export function useFeedbackMessage() {
  const store = useContext(FeedbackContext);
  const scope = useContext(ScopeContext);
  const owner = useMemo(
    () => ({ active: scope.active, leases: new Map<string, number>() }),
    [scope.id, scope.active],
  );
  useEffect(() => {
    owner.active = scope.active;
    return () => {
      owner.active = false;
      queueMicrotask(() => {
        if (owner.active) return; // StrictMode setup has renewed the same owner.
        for (const [id, lease] of owner.leases) store?.getState().release(id, lease);
        owner.leases.clear();
      });
    };
  }, [store, owner, scope.active]);
  return useMemo(() => {
    const publish = (type: FeedbackEvent['type']) => (title: string) => {
      if (!store || !owner.active) return;
      const id = `operation:${++sequence}`;
      // An error raised by a form belongs in that form's existing dialog.
      // Success often closes a form in the same update and belongs to the global queue.
      const host =
        type === 'success' || typeof document === 'undefined'
          ? undefined
          : Array.from(document.querySelectorAll<HTMLElement>('[data-feedback-host]'))
              .filter((node) => node.getClientRects().length > 0)
              .at(-1)?.dataset.feedbackHost;
      const lease = store.getState().publish({
        id,
        revision: id,
        scope: scope.id,
        context: scope.label,
        title,
        type,
        mode: 'modal',
        host,
      });
      owner.leases.set(id, lease);
    };
    return {
      error: publish('error'),
      warning: publish('warning'),
      info: publish('info'),
      success: publish('success'),
    };
  }, [store, owner, scope.id, scope.label]);
}
