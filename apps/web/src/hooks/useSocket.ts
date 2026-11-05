import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, Socket } from 'socket.io-client';

import { currentUiAgent, observeUiAgent } from '../api/ui-agent';

export function useSocket(events: Record<string, (...args: any[]) => void>) {
  const uiAgent = useSyncExternalStore(observeUiAgent, currentUiAgent);
  const socketRef = useRef<Socket | null>(null);

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
    const socket = io({ transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected');
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    Object.entries(events).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    return () => {
      Object.entries(events).forEach(([event, handler]) => {
        socket.off(event, handler);
      });
      socket.disconnect();
    };
  }, [uiAgent]);

  return socketRef;
}
