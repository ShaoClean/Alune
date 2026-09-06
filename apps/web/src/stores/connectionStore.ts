import { create } from 'zustand';
import { connectionApi } from '../api';

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

export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  testResults: {},
  loading: false,
  error: null,

  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const connections = await connectionApi.list();
      set({ connections, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  addConnection: async (data) => {
    const connection = await connectionApi.create(data);
    set((state) => ({ connections: [...state.connections, connection] }));
    return connection;
  },

  deleteConnection: async (id) => {
    await connectionApi.delete(id);
    set((state) => ({ connections: state.connections.filter((c) => c.id !== id) }));
  },

  testConnection: async (id) => {
    const result = await connectionApi.test(id);
    set((state) => ({ testResults: { ...state.testResults, [id]: result } }));
    return result;
  },
}));
