import { useEffect, useSyncExternalStore } from 'react';

import { currentUiAgent, observeUiAgent } from '../api/ui-agent';
import { subscribeWorkspaceEvents } from '../api/workspace-events';

export function useSocket(events: Record<string, (...args: any[]) => void>) {
  const uiAgent = useSyncExternalStore(observeUiAgent, currentUiAgent);

  useEffect(() => {
    if (uiAgent) {
      return subscribeWorkspaceEvents(uiAgent, events);
    }
    events.disconnect?.();
  }, [uiAgent]);
}
