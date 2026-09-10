import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { REPOSITORY_STATUS_CACHE_MS } from '@remote-git/shared';
import type { RepositoryStatus } from '@remote-git/shared';
import { repositoryApi } from '../api';
import { hydrateWorkspace, useWorkspaceStore } from './workspaceStore';

export interface RepositoryStatusEntry {
  phase: 'queued' | 'loading' | 'success' | 'error';
  data?: RepositoryStatus;
  error?: string;
  updatedAt?: number;
  stale?: boolean;
}

const statusSummary = (data?: RepositoryStatus) =>
  data
    ? {
        currentBranch: data.branch,
        ahead: data.ahead,
        behind: data.behind,
        isDirty: data.files.length > 0,
      }
    : {};
const errorMessage = (error: any) => error.response?.data?.message || error.message || '请求失败';

type StatusJob = {
  id: string;
  foreground: boolean;
  started: boolean;
  controller: AbortController;
  promise: Promise<void>;
  resolve: () => void;
};

interface RepositoryState {
  repositories: any[];
  openRepositories: any[];
  currentRepo: any | null;
  status: RepositoryStatus | null;
  log: any[];
  logLoading: boolean;
  remotesLoading: boolean;
  branches: any[];
  stashes: any[];
  remotes: any[];
  commitFiles: any[];
  commitFilesLoading: boolean;
  commitFilesError: string | null;
  diff: string;
  diffLoading: boolean;
  diffError: string | null;
  listLoading: boolean;
  listLoaded: boolean;
  listError: string | null;
  repositoryStatuses: Record<string, RepositoryStatusEntry>;
  observeRepository: (id: string) => () => void;
  refreshRepositoryStatuses: (ids?: string[]) => Promise<void>;
  error: string | null;
  fetchRepositories: (connectionId?: string) => Promise<void>;
  scanRepositories: (connectionId: string, path: string) => Promise<string[]>;
  addRepository: (connectionId: string, path: string) => Promise<any>;
  deleteRepository: (id: string) => Promise<void>;
  openRepository: (repo: any) => void;
  closeRepository: (id: string) => void;
  setCurrentRepo: (repo: any) => void;
  resetWorkspace: (id?: string) => void;
  fetchStatus: (id: string, afterMutation?: boolean) => Promise<void>;
  fetchLog: (id: string, params?: any) => Promise<void>;
  fetchCommitFiles: (id: string, commit: string, parentCommit?: string) => Promise<void>;
  fetchDiff: (id: string, params?: any) => Promise<void>;
  fetchBranches: (id: string) => Promise<void>;
  fetchStashes: (id: string) => Promise<void>;
  fetchRemotes: (id: string) => Promise<void>;
}

const repositoryState: StateCreator<RepositoryState> = (set, get) => {
  let listPromise: Promise<void> | null = null;
  let registryRevision = 0;
  let workspaceId: string | null = null;
  let logRequest = 0;
  let diffRequest = 0;
  let commitFilesRequest = 0;
  let branchRequest = 0;
  let stashRequest = 0;
  let remoteRequest = 0;

  const jobs = new Map<string, StatusJob>();
  const visible = new Map<string, number>();
  const removed = new Set<string>();
  let active = 0;
  let activeBackground = 0;

  const updateStatus = (id: string, entry: RepositoryStatusEntry) => {
    set((state) => ({ repositoryStatuses: { ...state.repositoryStatuses, [id]: entry } }));
  };
  const cancelStatus = (id: string) => {
    const job = jobs.get(id);
    if (job) {
      jobs.delete(id);
      job.controller.abort();
      job.resolve();
    }
  };
  const drain = () => {
    // Reserve one of three slots for an explicitly opened workspace. Hidden or slow
    // cards cannot consume it. Background requests only start for visible content.
    while (active < 3) {
      const queued = [...jobs.values()].filter((job) => !job.started);
      const job =
        queued.find((job) => job.foreground) ||
        (activeBackground < 2 ? queued.find((job) => !job.foreground) : undefined);
      if (!job) break;
      job.started = true;
      active++;
      const background = !job.foreground;
      if (background) activeBackground++;
      updateStatus(job.id, {
        ...get().repositoryStatuses[job.id],
        phase: 'loading',
        error: undefined,
      });
      void (async () => {
        try {
          const data = await repositoryApi.status(job.id, job.controller.signal);
          if (jobs.get(job.id) !== job || removed.has(job.id)) return;
          const entry: RepositoryStatusEntry = {
            phase: 'success',
            data,
            updatedAt: Date.now(),
            stale: false,
          };
          const summary = statusSummary(data);
          set((state) => ({
            repositoryStatuses: { ...state.repositoryStatuses, [job.id]: entry },
            repositories: state.repositories.map((repo) =>
              repo.id === job.id ? { ...repo, ...summary } : repo,
            ),
            openRepositories: state.openRepositories.map((repo) =>
              repo.id === job.id ? { ...repo, ...summary } : repo,
            ),
            currentRepo:
              state.currentRepo?.id === job.id
                ? { ...state.currentRepo, ...summary }
                : state.currentRepo,
            ...(workspaceId === job.id ? { status: data } : {}),
          }));
        } catch (error) {
          if (jobs.get(job.id) !== job || removed.has(job.id)) return;
          updateStatus(job.id, {
            ...get().repositoryStatuses[job.id],
            phase: 'error',
            stale: true,
            error: errorMessage(error),
          });
        } finally {
          if (jobs.get(job.id) === job) jobs.delete(job.id);
          active--;
          if (background) activeBackground--;
          job.resolve();
          drain();
        }
      })();
    }
  };
  const requestStatus = (id: string, force = false, foreground = false): Promise<void> => {
    if (removed.has(id)) return Promise.resolve();
    const pending = jobs.get(id);
    if (pending) {
      if (foreground) pending.foreground = true;
      drain();
      return pending.promise;
    }
    const cached = get().repositoryStatuses[id];
    // Failed reads retry only on an explicit refresh/open, never in a render loop.
    if (
      !force &&
      (cached?.phase === 'error' ||
        (cached?.updatedAt !== undefined &&
          Date.now() - cached.updatedAt < REPOSITORY_STATUS_CACHE_MS))
    )
      return Promise.resolve();
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const job: StatusJob = {
      id,
      foreground,
      started: false,
      controller: new AbortController(),
      promise,
      resolve,
    };
    jobs.set(id, job);
    updateStatus(id, { ...cached, phase: 'queued', error: undefined });
    // Batch observers from the same paint so the current workspace can go first.
    queueMicrotask(drain);
    return promise;
  };

  return {
    repositories: [],
    openRepositories: [],
    currentRepo: null,
    status: null,
    log: [],
    logLoading: false,
    remotesLoading: false,
    branches: [],
    stashes: [],
    remotes: [],
    commitFiles: [],
    commitFilesLoading: false,
    commitFilesError: null,
    diff: '',
    diffLoading: false,
    diffError: null,
    listLoading: false,
    listLoaded: false,
    listError: null,
    repositoryStatuses: {},
    error: null,

    observeRepository: (id) => {
      visible.set(id, (visible.get(id) || 0) + 1);
      void requestStatus(id);
      return () => {
        const count = (visible.get(id) || 1) - 1;
        if (count) visible.set(id, count);
        else {
          visible.delete(id);
          const job = jobs.get(id);
          if (job && !job.started && !job.foreground) {
            cancelStatus(id);
            set((state) => {
              const repositoryStatuses = { ...state.repositoryStatuses };
              const cached = repositoryStatuses[id];
              if (cached?.data) repositoryStatuses[id] = { ...cached, phase: 'success' };
              else delete repositoryStatuses[id];
              return { repositoryStatuses };
            });
          }
        }
      };
    },

    refreshRepositoryStatuses: async (ids) => {
      const targets = new Set(ids ?? visible.keys());
      const currentId = workspaceId || get().currentRepo?.id;
      if (currentId) targets.add(currentId);
      await Promise.all([...targets].map((id) => requestStatus(id, true, id === currentId)));
    },

    fetchRepositories: async () => {
      if (listPromise) return listPromise;
      set({ listLoading: true, listError: null });
      listPromise = (async () => {
        try {
          await hydrateWorkspace();
          // The sidebar always needs the full registry; filtering is local to the page.
          let repositories: any[];
          let revision: number;
          do {
            revision = registryRevision;
            repositories = await repositoryApi.list();
          } while (revision !== registryRevision);
          useWorkspaceStore.getState().reconcileRepositories(repositories);
          const ids = new Set(repositories.map((repo) => repo.id));
          // Only this successful, complete registry may prune cache and preferences.
          for (const id of new Set([
            ...get().repositories.map((repo) => repo.id),
            ...jobs.keys(),
            ...Object.keys(get().repositoryStatuses),
          ])) {
            if (!ids.has(id)) {
              removed.add(id);
              cancelStatus(id);
            }
          }
          for (const id of ids) removed.delete(id);
          set((state) => ({
            repositories: repositories.map((repo) => ({
              ...repo,
              ...statusSummary(state.repositoryStatuses[repo.id]?.data),
            })),
            repositoryStatuses: Object.fromEntries(
              Object.entries(state.repositoryStatuses).filter(([id]) => ids.has(id)),
            ),
            listLoading: false,
            listLoaded: true,
            listError: null,
          }));
        } catch (err: any) {
          set({ listError: errorMessage(err), listLoading: false });
        }
      })();
      try {
        await listPromise;
      } finally {
        listPromise = null;
      }
    },

    scanRepositories: async (connectionId, path) => {
      return repositoryApi.scan(connectionId, path);
    },

    addRepository: async (connectionId, path) => {
      const repo = await repositoryApi.add(connectionId, path);
      registryRevision += 1;
      removed.delete(repo.id);
      set((state) => ({ repositories: [...state.repositories, repo] }));
      useWorkspaceStore.getState().addRepository(repo);
      return repo;
    },

    deleteRepository: async (id) => {
      await repositoryApi.delete(id);
      registryRevision += 1;
      removed.add(id);
      cancelStatus(id);
      if (workspaceId === id) get().resetWorkspace();
      set((state) => ({
        repositoryStatuses: Object.fromEntries(
          Object.entries(state.repositoryStatuses).filter(([key]) => key !== id),
        ),
        repositories: state.repositories.filter((r) => r.id !== id),
        openRepositories: state.openRepositories.filter((r) => r.id !== id),
        currentRepo: state.currentRepo?.id === id ? null : state.currentRepo,
      }));
      useWorkspaceStore.getState().removeRepository(id);
    },

    openRepository: (repo) => {
      if (removed.has(repo.id)) return;
      repo = { ...repo, ...statusSummary(get().repositoryStatuses[repo.id]?.data) };
      set((state) => {
        const existing = state.openRepositories.find((item) => item.id === repo.id);
        const openRepositories = existing
          ? state.openRepositories.map((item) =>
              item.id === repo.id ? { ...item, ...repo } : item,
            )
          : [...state.openRepositories, repo];
        return { openRepositories, currentRepo: existing ? { ...existing, ...repo } : repo };
      });
    },

    closeRepository: (id) =>
      set((state) => ({
        openRepositories: state.openRepositories.filter((repo) => repo.id !== id),
        currentRepo: state.currentRepo?.id === id ? null : state.currentRepo,
      })),

    setCurrentRepo: (repo) => {
      if (removed.has(repo.id)) return;
      repo = { ...repo, ...statusSummary(get().repositoryStatuses[repo.id]?.data) };
      set((state) => {
        const existing = state.openRepositories.find((item) => item.id === repo.id);
        const openRepositories = existing
          ? state.openRepositories.map((item) =>
              item.id === repo.id ? { ...item, ...repo } : item,
            )
          : [...state.openRepositories, repo];
        return { currentRepo: existing ? { ...existing, ...repo } : repo, openRepositories };
      });
    },

    resetWorkspace: (id) => {
      const previousId = workspaceId;
      workspaceId = id ?? null;
      // Rapid switching must release the reserved slot for the newly active repo.
      if (previousId && previousId !== workspaceId && jobs.get(previousId)?.foreground) {
        cancelStatus(previousId);
        set((state) => {
          const repositoryStatuses = { ...state.repositoryStatuses };
          const previous = repositoryStatuses[previousId];
          if (previous?.data) repositoryStatuses[previousId] = { ...previous, phase: 'success' };
          else delete repositoryStatuses[previousId];
          return { repositoryStatuses };
        });
      }
      logRequest += 1;
      diffRequest += 1;
      commitFilesRequest += 1;
      branchRequest += 1;
      stashRequest += 1;
      remoteRequest += 1;
      set({
        status: id ? (get().repositoryStatuses[id]?.data ?? null) : null,
        log: [],
        logLoading: false,
        remotesLoading: false,
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

    fetchStatus: async (id, afterMutation = false) => {
      if (workspaceId !== null && workspaceId !== id) return;
      // A read begun before a Git write cannot validate that write. Share any
      // follow-up read, but wait out the older server request before starting it.
      if (afterMutation) {
        await jobs.get(id)?.promise;
        if (workspaceId !== id || removed.has(id)) return;
      }
      await requestStatus(id, true, true);
    },

    fetchLog: async (id, params) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++logRequest;
      set({ logLoading: true });
      try {
        const log = await repositoryApi.log(id, params);
        if (request === logRequest) set({ log, logLoading: false, error: null });
      } catch (err: any) {
        if (request === logRequest) set({ error: err.message, logLoading: false });
      }
    },

    fetchCommitFiles: async (id, commit, parentCommit) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++commitFilesRequest;
      set({ commitFiles: [], commitFilesLoading: true, commitFilesError: null });
      try {
        const commitFiles = await repositoryApi.commitFiles(id, commit, parentCommit);
        if (request === commitFilesRequest)
          set({ commitFiles, commitFilesLoading: false, commitFilesError: null, error: null });
      } catch (err: any) {
        if (request === commitFilesRequest)
          set({
            commitFiles: [],
            commitFilesLoading: false,
            commitFilesError: err.message,
            error: err.message,
          });
      }
    },

    fetchDiff: async (id, params) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++diffRequest;
      set({ diff: '', diffLoading: true, diffError: null });
      try {
        const diff = await repositoryApi.diff(id, params);
        if (request === diffRequest)
          set({ diff, diffLoading: false, diffError: null, error: null });
      } catch (err: any) {
        if (request === diffRequest)
          set({ diff: '', diffLoading: false, diffError: err.message, error: err.message });
      }
    },

    fetchBranches: async (id) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++branchRequest;
      try {
        const branches = await repositoryApi.branches(id);
        if (request === branchRequest) set({ branches, error: null });
      } catch (err: any) {
        if (request === branchRequest) set({ error: err.message });
      }
    },

    fetchStashes: async (id) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++stashRequest;
      try {
        const stashes = await repositoryApi.stashes(id);
        if (request === stashRequest) set({ stashes, error: null });
      } catch (err: any) {
        if (request === stashRequest) set({ error: err.message });
      }
    },

    fetchRemotes: async (id) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++remoteRequest;
      set({ remotesLoading: true });
      try {
        const remotes = await repositoryApi.remotes(id);
        if (request === remoteRequest) set({ remotes, remotesLoading: false, error: null });
      } catch (err: any) {
        if (request === remoteRequest) set({ error: err.message, remotesLoading: false });
      }
    },
  };
};

export const createRepositoryStore = () => create<RepositoryState>(repositoryState);
export const useRepositoryStore = createRepositoryStore();
