import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket(events: Record<string, (...args: any[]) => void>) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
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
  }, []);

  return socketRef;
}