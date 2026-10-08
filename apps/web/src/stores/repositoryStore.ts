import type { PartialDiffPreview } from '@alune/shared';
import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { REPOSITORY_STATUS_CACHE_MS } from '@alune/shared';
import type { Repository, RepositoryStatus, GraphCommit, DiffOptions } from '@alune/shared';
import { repositoryApi } from '../api';
import { hydrateWorkspace, useWorkspaceStore } from './workspaceStore';
import { moveBeforeOrAfter } from './sidebarOrder';
import type { Placement } from './sidebarOrder';

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
        ...(data.worktreeKind ? { worktreeKind: data.worktreeKind } : {}),
      }
    : {};
/** History filters survive refreshes until cleared or replaced. */
export interface HistoryFilter {
  search?: string;
  author?: string;
  /** Unix seconds, inclusive. */
  since?: number;
  until?: number;
  /** A file or directory relative to the repository root. */
  file?: string;
  /** Follow `file` across renames. */
  follow?: boolean;
  currentBranch?: boolean;
}
export const historyFilterActive = (filter: HistoryFilter) =>
  Object.values(filter).some((value) => value !== undefined && value !== '' && value !== false);
/** Filters other than a plain path leave gaps that parents cannot connect. */
export const linearHistory = (filter: HistoryFilter) =>
  !!(filter.search || filter.author || filter.since || filter.until || filter.follow);

const errorMessage = (error: any) => error.response?.data?.message || error.message || '请求失败';

type StatusJob = {
  id: string;
  foreground: boolean;
  refreshDiff: boolean;
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
  log: GraphCommit[];
  logBranch?: string;
  logFilter: HistoryFilter;
  logLoading: boolean;
  logLoadingMore: boolean;
  logHasMore: boolean;
  logNextSkip: number;
  logRevision: string | null;
  logGeneration: number;
  logShallow: boolean;
  logError: string | null;
  logChanged: boolean;
  logErrorMode: 'refresh' | 'more';
  remotesLoading: boolean;
  branches: any[];
  stashes: any[];
  remotes: any[];
  commitFiles: any[];
  commitFilesLoading: boolean;
  commitFilesError: string | null;
  diff: string;
  partialDiff: PartialDiffPreview | null;
  diffLoading: boolean;
  diffRefreshing: boolean;
  diffKey: string | null;
  worktreeDiffRevision: number;
  diffError: string | null;
  listLoading: boolean;
  listLoaded: boolean;
  listError: string | null;
  repositoryStatuses: Record<string, RepositoryStatusEntry>;
  observeRepository: (id: string) => () => void;
  refreshRepositoryStatuses: (ids?: string[]) => Promise<void>;
  error: string | null;
  errorPanel: 'branches' | 'stashes' | 'remotes' | null;
  fetchRepositories: (connectionId?: string) => Promise<void>;
  scanRepositories: (connectionId: string, path: string) => Promise<string[]>;
  addRepository: (connectionId: string, path: string) => Promise<any>;
  addLocalRepository: (path: string) => Promise<Repository>;
  registerRepository: (repo: Repository) => void;
  forgetRepositories: (ids: string[]) => void;
  addWorktree: (id: string, path: string) => Promise<Repository>;
  deleteRepository: (id: string) => Promise<void>;
  openRepository: (repo: any) => void;
  moveOpenRepository: (sourceId: string, targetId: string, placement: Placement) => boolean;
  closeRepository: (id: string) => void;
  closeRepositories: (ids: string[], preferredId?: string) => void;
  activateRepositoryTab: (id: string) => void;
  setCurrentRepo: (repo: any) => void;
  resetWorkspace: (id?: string) => void;
  fetchStatus: (id: string, afterMutation?: boolean) => Promise<void>;
  /** A `branch` (a jump to one commit's ancestry) clears the history filter. */
  fetchLog: (id: string, mode?: 'refresh' | 'more', branch?: string) => Promise<void>;
  setLogFilter: (id: string, filter: HistoryFilter) => Promise<void>;
  fetchCommitFiles: (id: string, commit: string, parentCommit?: string) => Promise<void>;
  fetchDiff: (id: string, params?: DiffOptions) => Promise<void>;
  clearDiff: () => void;
  fetchBranches: (id: string) => Promise<void>;
  fetchStashes: (id: string) => Promise<void>;
  fetchRemotes: (id: string) => Promise<void>;
}

const repositoryState: StateCreator<RepositoryState> = (set, get) => {
  let listPromise: Promise<void> | null = null;
  let registryRevision = 0;
  let workspaceId: string | null = null;
  let logRequest = 0;
  let logController: AbortController | null = null;
  let diffRequest = 0;
  let diffController: AbortController | null = null;
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
            ...(workspaceId === job.id
              ? {
                  status: data,
                  worktreeDiffRevision: state.worktreeDiffRevision + (job.refreshDiff ? 1 : 0),
                }
              : {}),
          }));
        } catch (error) {
          if (jobs.get(job.id) !== job || removed.has(job.id)) return;
          updateStatus(job.id, {
            ...get().repositoryStatuses[job.id],
            phase: 'error',
            stale: true,
            error: errorMessage(error),
          });
          // A failed status read must not leave a pre-mutation preview current.
          if (workspaceId === job.id && job.refreshDiff)
            set((state) => ({ worktreeDiffRevision: state.worktreeDiffRevision + 1 }));
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
  const requestStatus = (
    id: string,
    force = false,
    foreground = false,
    refreshDiff = false,
  ): Promise<void> => {
    if (removed.has(id)) return Promise.resolve();
    const pending = jobs.get(id);
    if (pending) {
      if (foreground) pending.foreground = true;
      if (refreshDiff) pending.refreshDiff = true;
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
      refreshDiff,
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
    logBranch: undefined,
    logFilter: {},
    logLoading: false,
    logLoadingMore: false,
    logHasMore: false,
    logNextSkip: 0,
    logRevision: null,
    logGeneration: 0,
    logShallow: false,
    logError: null,
    logChanged: false,
    logErrorMode: 'refresh',
    remotesLoading: false,
    branches: [],
    stashes: [],
    remotes: [],
    commitFiles: [],
    commitFilesLoading: false,
    commitFilesError: null,
    diff: '',
    partialDiff: null,
    diffLoading: false,
    diffRefreshing: false,
    diffKey: null,
    worktreeDiffRevision: 0,
    diffError: null,
    listLoading: false,
    listLoaded: false,
    listError: null,
    repositoryStatuses: {},
    error: null,
    errorPanel: null,

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
      await Promise.all([...targets].map((id) => requestStatus(id, true, id === currentId, true)));
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
          const savedIds = useWorkspaceStore.getState().repositorySession.ids;
          useWorkspaceStore.getState().reconcileRepositories(repositories);
          const ids = new Set(repositories.map((repo) => repo.id));
          const byId = new Map(repositories.map((repo) => [repo.id, repo]));
          // Only this successful, complete registry may prune cache and preferences.
          for (const id of new Set([
            ...get().repositories.map((repo) => repo.id),
            ...savedIds,
            ...get().openRepositories.map((repo) => repo.id),
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
            // Restore registration metadata only; workspace requests belong to the active page.
            openRepositories: useWorkspaceStore.getState().repositorySession.ids.map((id) => ({
              ...byId.get(id),
              ...statusSummary(state.repositoryStatuses[id]?.data),
            })),
            currentRepo:
              state.currentRepo && ids.has(state.currentRepo.id)
                ? { ...state.currentRepo, ...byId.get(state.currentRepo.id) }
                : null,
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

    registerRepository: (repo) => {
      registryRevision++;
      removed.delete(repo.id);
      set((state) => ({
        repositories: [...state.repositories.filter((item) => item.id !== repo.id), repo],
      }));
      useWorkspaceStore.getState().addRepository(repo);
    },
    addLocalRepository: async (path) => {
      const repo = await repositoryApi.addLocal(path);
      get().registerRepository(repo);
      return repo;
    },
    forgetRepositories: (ids) => {
      registryRevision++;
      useWorkspaceStore.getState().closeRepositoryTabs(ids);
      for (const id of ids) {
        removed.add(id);
        cancelStatus(id);
        useWorkspaceStore.getState().removeRepository(id);
      }
      set((state) => ({
        repositories: state.repositories.filter((repo) => !ids.includes(repo.id)),
        openRepositories: state.openRepositories.filter((repo) => !ids.includes(repo.id)),
        repositoryStatuses: Object.fromEntries(
          Object.entries(state.repositoryStatuses).filter(([id]) => !ids.includes(id)),
        ),
        currentRepo: ids.includes(state.currentRepo?.id) ? null : state.currentRepo,
      }));
    },

    addWorktree: async (id, path) => {
      const repo = await repositoryApi.openWorktree(id, path);
      registryRevision += 1;
      removed.delete(repo.id);
      set((state) => ({
        repositories: state.repositories.some((item) => item.id === repo.id)
          ? state.repositories.map((item) => (item.id === repo.id ? { ...item, ...repo } : item))
          : [...state.repositories, repo],
      }));
      useWorkspaceStore.getState().addRepository(repo);
      // Navigation belongs to the initiating view, which may have closed meanwhile.
      return repo;
    },

    deleteRepository: async (id) => {
      await repositoryApi.delete(id);
      registryRevision += 1;
      removed.add(id);
      cancelStatus(id);
      if (workspaceId === id) get().resetWorkspace();
      useWorkspaceStore.getState().closeRepositoryTabs([id]);
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
      useWorkspaceStore.getState().activateRepositoryTab(repo.id);
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

    moveOpenRepository: (sourceId, targetId, placement) => {
      const openRepositories = get().openRepositories;
      const ids = openRepositories.map((repo) => repo.id);
      const reordered = moveBeforeOrAfter(ids, sourceId, targetId, placement);
      if (reordered === ids) return false;
      const byId = new Map(openRepositories.map((repo) => [repo.id, repo]));
      set({ openRepositories: reordered.map((id) => byId.get(id)!) });
      useWorkspaceStore.getState().moveRepositoryTab(sourceId, targetId, placement);
      return true;
    },

    closeRepository: (id) => get().closeRepositories([id]),

    // Only closes tabs; registrations, statuses and commit drafts stay intact.
    closeRepositories: (ids, preferredId) => {
      useWorkspaceStore.getState().closeRepositoryTabs(ids, preferredId);
      const closing = new Set(ids);
      set((state) => ({
        openRepositories: state.openRepositories.filter((repo) => !closing.has(repo.id)),
        currentRepo:
          state.currentRepo && closing.has(state.currentRepo.id) ? null : state.currentRepo,
      }));
    },

    setCurrentRepo: (repo) => {
      if (removed.has(repo.id)) return;
      useWorkspaceStore.getState().activateRepositoryTab(repo.id);
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

    activateRepositoryTab: (id) => {
      if (
        removed.has(id) ||
        (get().listLoaded && !get().repositories.some((repo) => repo.id === id))
      )
        return;
      useWorkspaceStore.getState().activateRepositoryTab(id);
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
      logController?.abort();
      diffRequest += 1;
      diffController?.abort();
      commitFilesRequest += 1;
      branchRequest += 1;
      stashRequest += 1;
      remoteRequest += 1;
      set({
        status: id ? (get().repositoryStatuses[id]?.data ?? null) : null,
        log: [],
        logBranch: undefined,
        logFilter: {},
        logLoading: false,
        logLoadingMore: false,
        logHasMore: false,
        logNextSkip: 0,
        logRevision: null,
        logGeneration: get().logGeneration + 1,
        logShallow: false,
        logError: null,
        logChanged: false,
        logErrorMode: 'refresh',
        remotesLoading: false,
        branches: [],
        stashes: [],
        remotes: [],
        commitFiles: [],
        commitFilesLoading: false,
        commitFilesError: null,
        diff: '',
        partialDiff: null,
        diffLoading: false,
        diffRefreshing: false,
        diffKey: null,
        worktreeDiffRevision: 0,
        diffError: null,
        error: null,
        errorPanel: null,
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
      await requestStatus(id, true, true, afterMutation);
    },

    fetchLog: async (id, mode = 'refresh', branch) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const append = mode === 'more';
      const state = get();
      if (
        append &&
        (state.logLoading || state.logLoadingMore || !state.logHasMore || state.logChanged)
      )
        return;
      logController?.abort();
      const controller = new AbortController();
      logController = controller;
      const request = ++logRequest;
      const filter = branch && !append ? {} : state.logFilter;
      const scope = append ? state.logBranch : branch;
      set({
        logLoading: !append,
        logLoadingMore: append,
        logError: null,
        logChanged: false,
        logErrorMode: mode,
        logFilter: filter,
      });
      try {
        const page = await repositoryApi.log(
          id,
          {
            count: 50,
            ...(scope ? { branch: scope } : filter.currentBranch ? { branch: 'HEAD' } : {}),
            ...(filter.search ? { search: filter.search } : {}),
            ...(filter.author ? { author: filter.author } : {}),
            ...(filter.since ? { since: filter.since } : {}),
            ...(filter.until ? { until: filter.until } : {}),
            ...(filter.file ? { file: filter.file } : {}),
            ...(filter.file && filter.follow ? { follow: true } : {}),
            ...(append ? { skip: state.logNextSkip, revision: state.logRevision! } : {}),
          },
          controller.signal,
        );
        if (request !== logRequest) return;
        set((current) => {
          const seen = new Set(append ? current.log.map((commit) => commit.hash) : []);
          const added = page.commits.filter((commit) => {
            if (seen.has(commit.hash)) return false;
            seen.add(commit.hash);
            return true;
          });
          return {
            log: append ? [...current.log, ...added] : added,
            logLoading: false,
            logLoadingMore: false,
            logError: null,
            logHasMore: page.hasMore,
            logBranch: append ? current.logBranch : branch,
            logNextSkip: page.nextSkip,
            logRevision: page.revision,
            logShallow: page.shallow,
            logGeneration: current.logGeneration + (append ? 0 : 1),
          };
        });
      } catch (err: any) {
        if (request === logRequest)
          set({
            logError: errorMessage(err),
            logLoading: false,
            logLoadingMore: false,
            logChanged: err.response?.data?.code === 'HISTORY_CHANGED',
          });
      }
    },

    setLogFilter: (id, filter) => {
      if (workspaceId !== null && workspaceId !== id) return Promise.resolve();
      set({ logFilter: filter, logBranch: undefined });
      return get().fetchLog(id);
    },

    fetchCommitFiles: async (id, commit, parentCommit) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++commitFilesRequest;
      set({ commitFiles: [], commitFilesLoading: true, commitFilesError: null });
      try {
        const commitFiles = await repositoryApi.commitFiles(id, commit, parentCommit);
        if (request === commitFilesRequest)
          set({ commitFiles, commitFilesLoading: false, commitFilesError: null });
      } catch (err: any) {
        if (request === commitFilesRequest)
          set({
            commitFiles: [],
            commitFilesLoading: false,
            commitFilesError: err.message,
          });
      }
    },

    clearDiff: () => {
      diffRequest += 1;
      diffController?.abort();
      set({
        diff: '',
        partialDiff: null,
        diffLoading: false,
        diffRefreshing: false,
        diffKey: null,
        diffError: null,
      });
    },

    fetchDiff: async (id, params) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++diffRequest;
      diffController?.abort();
      const controller = new AbortController();
      diffController = controller;
      const diffKey = JSON.stringify([
        id,
        params?.file ?? null,
        params?.staged ?? false,
        params?.commit ?? null,
        params?.parentCommit ?? null,
      ]);
      const state = get();
      const refreshing = state.diffKey === diffKey && !state.diffLoading && !state.diffError;
      set({
        diffKey,
        diff: refreshing ? state.diff : '',
        partialDiff: refreshing ? state.partialDiff : null,
        diffLoading: !refreshing,
        diffRefreshing: refreshing,
        diffError: null,
      });
      try {
        const diff = await repositoryApi.diff(id, params, controller.signal);
        if (request !== diffRequest) return;
        // Reading must not wait for the snapshots required by partial writes.
        // The displayed patch has no actionable revision until validation finishes.
        const editable = !!(params?.file && !params.commit && !params.parentCommit);
        set({
          diff,
          partialDiff: editable ? { diff } : null,
          diffLoading: false,
          diffRefreshing: editable,
          diffError: null,
        });
        if (editable) {
          try {
            const response = await repositoryApi.diff(
              id,
              { ...params, editable: true },
              controller.signal,
            );
            const partialDiff: PartialDiffPreview =
              typeof response === 'string' ? { diff: response } : response;
            if (request === diffRequest)
              set({ diff: partialDiff.diff, partialDiff, diffRefreshing: false });
          } catch (error: any) {
            if (request === diffRequest)
              set({
                partialDiff: { diff, unavailableReason: errorMessage(error) },
                diffRefreshing: false,
              });
          }
        }
      } catch (err: any) {
        if (request === diffRequest)
          set({
            diff: '',
            partialDiff: null,
            diffLoading: false,
            diffRefreshing: false,
            diffError: errorMessage(err),
          });
      } finally {
        if (diffController === controller) diffController = null;
      }
    },

    fetchBranches: async (id) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++branchRequest;
      set({ error: null });
      try {
        const branches = await repositoryApi.branches(id);
        if (request === branchRequest) set({ branches, error: null });
      } catch (err: any) {
        if (request === branchRequest) set({ error: err.message, errorPanel: 'branches' });
      }
    },

    fetchStashes: async (id) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++stashRequest;
      set({ error: null });
      try {
        const stashes = await repositoryApi.stashes(id);
        if (request === stashRequest) set({ stashes, error: null });
      } catch (err: any) {
        if (request === stashRequest) set({ error: err.message, errorPanel: 'stashes' });
      }
    },

    fetchRemotes: async (id) => {
      if (workspaceId !== null && workspaceId !== id) return;
      const request = ++remoteRequest;
      set({ remotesLoading: true, error: null });
      try {
        const remotes = await repositoryApi.remotes(id);
        if (request === remoteRequest) set({ remotes, remotesLoading: false, error: null });
      } catch (err: any) {
        if (request === remoteRequest)
          set({ error: err.message, errorPanel: 'remotes', remotesLoading: false });
      }
    },
  };
};

export const createRepositoryStore = () => create<RepositoryState>(repositoryState);
export const useRepositoryStore = createRepositoryStore();
