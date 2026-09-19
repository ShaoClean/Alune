import { create } from 'zustand';
import type { ConnectionStatusInfo, ConnectionTestResult } from '@remote-git/shared';
import { connectionApi } from '../api';
import { hydrateWorkspace, useWorkspaceStore } from './workspaceStore';

interface ConnectionState {
  connections: any[];
  statuses: Record<string, ConnectionStatusInfo>;
  loading: boolean;
  error: string | null;
  fetchConnections: () => Promise<void>;
  addConnection: (data: any) => Promise<any>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<ConnectionTestResult>;
  applyConnectionStatus: (event: {
    connectionId: string;
    status: ConnectionStatusInfo['status'];
    error?: string;
    updatedAt?: number;
  }) => void;
}

const readStatus = (connection: any): ConnectionStatusInfo | null =>
  connection && typeof connection.status === 'string'
    ? {
        status: connection.status,
        error: connection.error,
        updatedAt: typeof connection.updatedAt === 'number' ? connection.updatedAt : undefined,
      }
    : null;

// A list response describes an older moment than an event already applied for
// that same connection, so never let it overwrite newer pushed state.
const newer = (next: ConnectionStatusInfo, previous?: ConnectionStatusInfo) => {
  if (!previous) return true;
  if (next.updatedAt === undefined || previous.updatedAt === undefined)
    return next.updatedAt !== undefined || previous.updatedAt === undefined;
  return next.updatedAt > previous.updatedAt;
};

export const useConnectionStore = create<ConnectionState>((set) => {
  let listPromise: Promise<void> | null = null;
  let registryRevision = 0;
  return {
  connections: [],
  statuses: {},
  loading: false,
  error: null,

  fetchConnections: async () => {
    if (listPromise) return listPromise;
    set({ loading: true, error: null });
    listPromise = (async () => {
      try {
        await hydrateWorkspace();
        let connections: any[];
        let revision: number;
        do {
          revision = registryRevision;
          connections = await connectionApi.list();
        } while (revision !== registryRevision);
        useWorkspaceStore.getState().reconcileConnections(connections.map((connection) => connection.id));
        set((state) => {
          const statuses: Record<string, ConnectionStatusInfo> = {};
          for (const connection of connections) {
            const reported = readStatus(connection);
            const known = state.statuses[connection.id];
            if (reported && newer(reported, known)) statuses[connection.id] = reported;
            else if (known) statuses[connection.id] = known;
          }
          return { connections, statuses, loading: false };
        });
      } catch (err: any) {
        set({ error: err.message, loading: false });
      }
    })();
    try { await listPromise; } finally { listPromise = null; }
  },

  addConnection: async (data) => {
    const connection = await connectionApi.create(data);
    registryRevision += 1;
    set((state) => ({ connections: [...state.connections, connection] }));
    useWorkspaceStore.getState().addConnection(connection.id);
    return connection;
  },

  deleteConnection: async (id) => {
    await connectionApi.delete(id);
    registryRevision += 1;
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      statuses: Object.fromEntries(
        Object.entries(state.statuses).filter(([key]) => key !== id),
      ),
    }));
    useWorkspaceStore.getState().removeConnection(id);
  },

  testConnection: async (id) => {
    const result = await connectionApi.test(id);
    // The server pushes the authoritative status. A test response is only a
    // fallback for a missed event, and may not replace a newer pushed value.
    set((state) => {
      const current = state.statuses[id];
      if (result.updatedAt === undefined && current && current.status !== 'unknown') return {};
      const next: ConnectionStatusInfo = {
        status: result.status || (result.success ? 'connected' : 'error'),
        error: result.error,
        updatedAt: result.updatedAt ?? Date.now(),
      };
      if (!newer(next, current)) return {};
      return { statuses: { ...state.statuses, [id]: next } };
    });
    return result;
  },

  applyConnectionStatus: ({ connectionId, status, error, updatedAt }) => {
    set((state) => {
      const next: ConnectionStatusInfo = { status, error, updatedAt: updatedAt ?? Date.now() };
      if (!newer(next, state.statuses[connectionId])) return {};
      return { statuses: { ...state.statuses, [connectionId]: next } };
    });
  },
  };
});
