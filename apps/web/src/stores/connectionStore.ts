import { create } from 'zustand';
import { connectionApi } from '../api';
import { hydrateWorkspace, useWorkspaceStore } from './workspaceStore';

interface ConnectionState {
  connections: any[];
  testResults: Record<string, { success: boolean; error?: string }>;
  loading: boolean;
  error: string | null;
  fetchConnections: () => Promise<void>;
  addConnection: (data: any) => Promise<any>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<{ success: boolean; error?: string }>;
}

export const useConnectionStore = create<ConnectionState>((set) => {
  let listPromise: Promise<void> | null = null;
  let registryRevision = 0;
  return {
  connections: [],
  testResults: {},
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
        set({ connections, loading: false });
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
    set((state) => ({ connections: state.connections.filter((c) => c.id !== id) }));
    useWorkspaceStore.getState().removeConnection(id);
  },

  testConnection: async (id) => {
    const result = await connectionApi.test(id);
    set((state) => ({ testResults: { ...state.testResults, [id]: result } }));
    return result;
  },
  };
});
