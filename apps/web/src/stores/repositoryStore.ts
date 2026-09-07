import { create } from 'zustand';
import { repositoryApi } from '../api';

interface RepositoryState {
  repositories: any[];
  openRepositories: any[];
  currentRepo: any | null;
  status: any | null;
  log: any[];
  branches: any[];
  stashes: any[];
  remotes: any[];
  commitFiles: any[];
  commitFilesLoading: boolean;
  commitFilesError: string | null;
  diff: string;
  diffLoading: boolean;
  diffError: string | null;
  loading: boolean;
  error: string | null;
  fetchRepositories: (connectionId?: string) => Promise<void>;
  scanRepositories: (connectionId: string, path: string) => Promise<string[]>;
  addRepository: (connectionId: string, path: string) => Promise<any>;
  deleteRepository: (id: string) => Promise<void>;
  openRepository: (repo: any) => void;
  closeRepository: (id: string) => void;
  setCurrentRepo: (repo: any) => void;
  resetWorkspace: () => void;
  fetchStatus: (id: string) => Promise<void>;
  fetchLog: (id: string, params?: any) => Promise<void>;
  fetchCommitFiles: (id: string, commit: string, parentCommit?: string) => Promise<void>;
  fetchDiff: (id: string, params?: any) => Promise<void>;
  fetchBranches: (id: string) => Promise<void>;
  fetchStashes: (id: string) => Promise<void>;
  fetchRemotes: (id: string) => Promise<void>;
}

export const useRepositoryStore = create<RepositoryState>((set) => {
  let statusRequest = 0;
  let logRequest = 0;
  let diffRequest = 0;
  let commitFilesRequest = 0;
  let branchRequest = 0;
  let stashRequest = 0;
  let remoteRequest = 0;

  return {
    repositories: [],
    openRepositories: [],
    currentRepo: null,
    status: null,
    log: [],
    branches: [],
    stashes: [],
    remotes: [],
    commitFiles: [],
    commitFilesLoading: false,
    commitFilesError: null,
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
    set((state) => ({
      repositories: state.repositories.filter((r) => r.id !== id),
      openRepositories: state.openRepositories.filter((r) => r.id !== id),
      currentRepo: state.currentRepo?.id === id ? null : state.currentRepo,
    }));
  },

  openRepository: (repo) => set((state) => {
    const existing = state.openRepositories.find((item) => item.id === repo.id);
    const openRepositories = existing
      ? state.openRepositories.map((item) => item.id === repo.id ? { ...item, ...repo } : item)
      : [...state.openRepositories, repo];
    return { openRepositories, currentRepo: existing ? { ...existing, ...repo } : repo };
  }),

  closeRepository: (id) => set((state) => ({
    openRepositories: state.openRepositories.filter((repo) => repo.id !== id),
    currentRepo: state.currentRepo?.id === id ? null : state.currentRepo,
  })),

  setCurrentRepo: (repo) => set((state) => {
    const existing = state.openRepositories.find((item) => item.id === repo.id);
    const openRepositories = existing
      ? state.openRepositories.map((item) => item.id === repo.id ? { ...item, ...repo } : item)
      : [...state.openRepositories, repo];
    return { currentRepo: existing ? { ...existing, ...repo } : repo, openRepositories };
  }),

  resetWorkspace: () => {
    statusRequest += 1;
    logRequest += 1;
    diffRequest += 1;
    commitFilesRequest += 1;
    branchRequest += 1;
    stashRequest += 1;
    remoteRequest += 1;
    set({
      status: null,
      log: [],
      branches: [],
      stashes: [],
      remotes: [],
      commitFiles: [],
      commitFilesLoading: false,
      commitFilesError: null,
      diff: '',
      diffLoading: false,
      diffError: null,
      error: null,
    });
  },

    fetchStatus: async (id) => {
      const request = ++statusRequest;
      try {
        const status = await repositoryApi.status(id);
        if (request === statusRequest) set((state) => {
          const statusSummary = {
            currentBranch: status.branch,
            ahead: status.ahead,
            behind: status.behind,
            isDirty: status.files?.length > 0,
          };
          return {
            status,
            error: null,
            currentRepo: state.currentRepo?.id === id ? { ...state.currentRepo, ...statusSummary } : state.currentRepo,
            openRepositories: state.openRepositories.map((repo) => repo.id === id ? { ...repo, ...statusSummary } : repo),
          };
        });
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

    fetchCommitFiles: async (id, commit, parentCommit) => {
      const request = ++commitFilesRequest;
      set({ commitFiles: [], commitFilesLoading: true, commitFilesError: null });
      try {
        const commitFiles = await repositoryApi.commitFiles(id, commit, parentCommit);
        if (request === commitFilesRequest) set({ commitFiles, commitFilesLoading: false, commitFilesError: null, error: null });
      } catch (err: any) {
        if (request === commitFilesRequest) set({ commitFiles: [], commitFilesLoading: false, commitFilesError: err.message, error: err.message });
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
