import { useContext, useEffect, useMemo, useRef } from 'react';
import { FeedbackContext, FeedbackHostContext, submittingFeedbackHost } from './feedback-context';
import { ScopeContext } from './FeedbackNotice';
import type { FeedbackEvent } from '../stores/feedbackStore';

let sequence = 0;
/** One-off operation results; they outlive their source and stay in the inbox until cleared. */
export function useFeedbackMessage() {
  const store = useContext(FeedbackContext);
  const scope = useContext(ScopeContext);
  const host = useContext(FeedbackHostContext);
  // Late results still arrive after navigation, but must not interrupt another view.
  const live = useRef({ visible: scope.active, host });
  live.current.host = host;
  useEffect(() => {
    live.current.visible = scope.active;
    return () => {
      live.current.visible = false;
    };
  }, [scope.active]);
  return useMemo(() => {
    const publish = (type: FeedbackEvent['type']) => (title: string) => {
      if (!store) return;
      const id = `operation:${++sequence}`;
      const { visible, host: owner } = live.current;
      // A form keeps the errors of its own controls and submission. Success
      // often closes the form in the same update and belongs to the inbox.
      const host =
        type === 'success' ? undefined : owner?.active ? owner.id : submittingFeedbackHost();
      store.getState().publish({
        id,
        revision: id,
        scope: scope.id,
        context: scope.label,
        title,
        type,
        mode: 'modal',
        kind: 'event',
        autoOpen: visible || Boolean(host),
        host,
      });
    };
    return {
      error: publish('error'),
      warning: publish('warning'),
      info: publish('info'),
      success: publish('success'),
    };
  }, [store, scope.id, scope.label]);
}

export type FeedbackMessageApi = ReturnType<typeof useFeedbackMessage>;
