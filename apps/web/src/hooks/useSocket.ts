import { useEffect, useSyncExternalStore } from 'react';

import { currentUiAgent, observeUiAgent } from '../api/ui-agent';

export function useSocket(events: Record<string, (...args: any[]) => void>) {
  const uiAgent = useSyncExternalStore(observeUiAgent, currentUiAgent);

  useEffect(() => {
    if (uiAgent) {
      events.connect?.();
      const dispose = uiAgent.onEvent((event) => {
        if (event.type === 'events.resync-required' || event.type === 'accounts.hosts.changed')
          events.connect?.();
        if (event.type === 'hosts.changed') {
          const p = event.payload as { hostId: string; status: string; updatedAt: number };
          events['connection:status']?.({ ...p, connectionId: p.hostId });
        }
        if (event.type === 'repositories.changed')
          events['repository:changed']?.(event.resource?.resourceId);
        if (event.type === 'accounts.tokens.changed') events['access-tokens:changed']?.();
      });
      const close = uiAgent.onClose(() => events.disconnect?.());
      return () => {
        dispose();
        close();
      };
    }
    events.disconnect?.();
  }, [uiAgent]);
}
