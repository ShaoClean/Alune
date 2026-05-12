import { create } from 'zustand';
import { repositoryApi } from '../api';

interface RepositoryState {
  repositories: any[];
  currentRepo: any | null;
  status: any | null;
  log: any[];
  branches: any[];
  stashes: any[];
  remotes: any[];
  diff: string;
  loading: boolean;
  error: string | null;
  fetchRepositories: (connectionId?: string) => Promise<void>;
  scanRepositories: (connectionId: string, path: string) => Promise<string[]>;
  addRepository: (connectionId: string, path: string) => Promise<any>;
  deleteRepository: (id: string) => Promise<void>;
  setCurrentRepo: (repo: any) => void;
  fetchStatus: (id: string) => Promise<void>;
  fetchLog: (id: string, params?: any) => Promise<void>;
  fetchDiff: (id: string, params?: any) => Promise<void>;
  fetchBranches: (id: string) => Promise<void>;
  fetchStashes: (id: string) => Promise<void>;
  fetchRemotes: (id: string) => Promise<void>;
}

export const useRepositoryStore = create<RepositoryState>((set) => ({
  repositories: [],
  currentRepo: null,
  status: null,
  log: [],
  branches: [],
  stashes: [],
  remotes: [],
  diff: '',
  loading: false,
  error: null,

  fetchRepositories: async (connectionId) => {
    set({ loading: true, error: null });
    try {
      const repositories = await repositoryApi.list(connectionId);
      set({ repositories, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  scanRepositories: async (connectionId, path) => {
    return repositoryApi.scan(connectionId, path);
  },

  addRepository: async (connectionId, path) => {
    const repo = await repositoryApi.add(connectionId, path);
    set((state) => ({ repositories: [...state.repositories, repo] }));
    return repo;
  },

  deleteRepository: async (id) => {
    await repositoryApi.delete(id);
    set((state) => ({ repositories: state.repositories.filter((r) => r.id !== id) }));
  },

  setCurrentRepo: (repo) => set({ currentRepo: repo }),

  fetchStatus: async (id) => {
    try {
      const status = await repositoryApi.status(id);
      set({ status });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchLog: async (id, params) => {
    try {
      const log = await repositoryApi.log(id, params);
      set({ log });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchDiff: async (id, params) => {
    try {
      const diff = await repositoryApi.diff(id, params);
      set({ diff });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchBranches: async (id) => {
    try {
      const branches = await repositoryApi.branches(id);
      set({ branches });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchStashes: async (id) => {
    try {
      const stashes = await repositoryApi.stashes(id);
      set({ stashes });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchRemotes: async (id) => {
    try {
      const remotes = await repositoryApi.remotes(id);
      set({ remotes });
    } catch (err: any) {
      set({ error: err.message });
    }
  },
}));