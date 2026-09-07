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
  diffLoading: boolean;
  diffError: string | null;
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

export const useRepositoryStore = create<RepositoryState>((set) => {
  let statusRequest = 0;
  let logRequest = 0;
  let diffRequest = 0;
  let branchRequest = 0;
  let stashRequest = 0;
  let remoteRequest = 0;

  return {
    repositories: [],
    currentRepo: null,
    status: null,
    log: [],
    branches: [],
    stashes: [],
    remotes: [],
    diff: '',
    diffLoading: false,
    diffError: null,
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
      const request = ++statusRequest;
      try {
        const status = await repositoryApi.status(id);
        if (request === statusRequest) set({ status, error: null });
      } catch (err: any) {
        if (request === statusRequest) set({ error: err.message });
      }
    },

    fetchLog: async (id, params) => {
      const request = ++logRequest;
      try {
        const log = await repositoryApi.log(id, params);
        if (request === logRequest) set({ log, error: null });
      } catch (err: any) {
        if (request === logRequest) set({ error: err.message });
      }
    },

    fetchDiff: async (id, params) => {
      const request = ++diffRequest;
      set({ diff: '', diffLoading: true, diffError: null });
      try {
        const diff = await repositoryApi.diff(id, params);
        if (request === diffRequest) set({ diff, diffLoading: false, diffError: null, error: null });
      } catch (err: any) {
        if (request === diffRequest) set({ diff: '', diffLoading: false, diffError: err.message, error: err.message });
      }
    },

    fetchBranches: async (id) => {
      const request = ++branchRequest;
      try {
        const branches = await repositoryApi.branches(id);
        if (request === branchRequest) set({ branches, error: null });
      } catch (err: any) {
        if (request === branchRequest) set({ error: err.message });
      }
    },

    fetchStashes: async (id) => {
      const request = ++stashRequest;
      try {
        const stashes = await repositoryApi.stashes(id);
        if (request === stashRequest) set({ stashes, error: null });
      } catch (err: any) {
        if (request === stashRequest) set({ error: err.message });
      }
    },

    fetchRemotes: async (id) => {
      const request = ++remoteRequest;
      try {
        const remotes = await repositoryApi.remotes(id);
        if (request === remoteRequest) set({ remotes, error: null });
      } catch (err: any) {
        if (request === remoteRequest) set({ error: err.message });
      }
    },
  };
});
