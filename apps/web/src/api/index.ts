import axios from 'axios';
import { REPOSITORY_STATUS_REQUEST_TIMEOUT_MS } from '@alune/shared';
import type {
  ConnectionTestResult,
  DiffImageContent,
  DiffImageOptions,
  NewFileDeletionPreview,
  LogOptions,
  LogPage,
  Repository,
  RepositoryContext,
  RepositoryStatus,
  RepositoryFilePreview,
  RepositoryTreeListing,
  WorktreeInfo,
} from '@alune/shared';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const detail = error.response?.data?.message;
    if (detail) error.message = Array.isArray(detail) ? detail.join('；') : String(detail);
    return Promise.reject(error);
  },
);
const gitTimeout = { timeout: 310_000 };

// Connection APIs
export const connectionApi = {
  list: () => api.get('/connections').then((r) => r.data),
  get: (id: string) => api.get(`/connections/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/connections', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/connections/${id}`).then((r) => r.data),
  test: (id: string): Promise<ConnectionTestResult> =>
    api.post(`/connections/${id}/test`).then((r) => r.data),
};

// Repository APIs
export const repositoryApi = {
  inspectLocal: (
    path: string,
  ): Promise<RepositoryContext & { name: string; status: RepositoryStatus }> =>
    api.post('/repositories/local/inspect', { path }).then((r) => r.data),
  addLocal: (path: string): Promise<Repository> =>
    api.post('/repositories', { source: 'local', path }).then((r) => r.data),
  context: (id: string, signal?: AbortSignal): Promise<RepositoryContext> =>
    api.get(`/repositories/${id}/context`, { signal }).then((r) => r.data),
  worktrees: (id: string, signal?: AbortSignal): Promise<WorktreeInfo[]> =>
    api
      .get('/repositories/' + id + '/worktrees', {
        signal,
        timeout: REPOSITORY_STATUS_REQUEST_TIMEOUT_MS,
      })
      .then((r) => r.data),
  openWorktree: (id: string, path: string): Promise<Repository> =>
    api
      .post(
        '/repositories/' + id + '/worktrees/open',
        { path },
        {
          timeout: REPOSITORY_STATUS_REQUEST_TIMEOUT_MS,
        },
      )
      .then((r) => r.data),
  scan: (connectionId: string, path: string) =>
    api.get('/repositories/scan', { params: { connectionId, path } }).then((r) => r.data),
  add: (connectionId: string, path: string) =>
    api.post('/repositories', { connectionId, path }).then((r) => r.data),
  list: (connectionId?: string) =>
    api.get('/repositories', { params: connectionId ? { connectionId } : {} }).then((r) => r.data),
  get: (id: string) => api.get(`/repositories/${id}`).then((r) => r.data),
  delete: (id: string) => api.delete(`/repositories/${id}`).then((r) => r.data),
  pin: (id: string, pinned: boolean) =>
    api.post(`/repositories/${id}/pin`, { pinned }).then((r) => r.data),
  status: (id: string, signal?: AbortSignal) =>
    api
      .get(`/repositories/${id}/status`, {
        signal,
        timeout: REPOSITORY_STATUS_REQUEST_TIMEOUT_MS,
      })
      .then((r) => r.data),
  log: (id: string, params?: LogOptions, signal?: AbortSignal): Promise<LogPage> =>
    api.get(`/repositories/${id}/log`, { params, signal }).then((r) => r.data),
  commitFiles: (id: string, commit: string, parentCommit?: string) =>
    api
      .get(`/repositories/${id}/commit-files`, { params: { commit, parentCommit } })
      .then((r) => r.data),
  diff: (id: string, params?: any) =>
    api.get(`/repositories/${id}/diff`, { params }).then((r) => r.data),
  diffImage: (
    id: string,
    params: DiffImageOptions,
    signal?: AbortSignal,
  ): Promise<DiffImageContent> =>
    api
      .get(`/repositories/${id}/diff-image`, { params, signal, timeout: 60000 })
      .then((r) => r.data),
  // Read-only worktree browsing; '' is the repository root.
  tree: (id: string, path: string, signal?: AbortSignal): Promise<RepositoryTreeListing> =>
    api.get(`/repositories/${id}/tree`, { params: { path }, signal }).then((r) => r.data),
  file: (id: string, path: string, signal?: AbortSignal): Promise<RepositoryFilePreview> =>
    api
      .get(`/repositories/${id}/file`, { params: { path }, signal, timeout: 60000 })
      .then((r) => r.data),
  branches: (id: string) => api.get(`/repositories/${id}/branches`).then((r) => r.data),
  stashes: (id: string) => api.get(`/repositories/${id}/stashes`).then((r) => r.data),
  remotes: (id: string) => api.get(`/repositories/${id}/remotes`).then((r) => r.data),
};

// Git Operation APIs
export const gitApi = {
  operation: (id: string) => api.get(`/repositories/${id}/operation`).then((r) => r.data),
  cancel: (id: string) => api.post(`/repositories/${id}/operation/cancel`).then((r) => r.data),
  deepen: (id: string, remote?: string) =>
    api.post(`/repositories/${id}/history/deepen`, { remote }, gitTimeout).then((r) => r.data),
  renameBranch: (id: string, name: string, newName: string) =>
    api
      .post(`/repositories/${id}/branch/rename`, { name, newName }, gitTimeout)
      .then((r) => r.data),
  stashShow: (id: string, index: number): Promise<{ diff: string }> =>
    api.post(`/repositories/${id}/stash/show`, { index }).then((r) => r.data),
  addRemote: (id: string, name: string, url: string) =>
    api.post(`/repositories/${id}/remotes`, { name, url }).then((r) => r.data),
  saveAuthor: (id: string, name: string, email: string) =>
    api.post(`/repositories/${id}/author`, { name, email }).then((r) => r.data),
  createWorktree: (id: string, path: string, branch: string): Promise<Repository> =>
    api
      .post(`/repositories/${id}/worktrees/create`, { path, branch }, gitTimeout)
      .then((r) => r.data),
  removeWorktree: (id: string, path: string): Promise<{ removedIds: string[] }> =>
    api
      .post(`/repositories/${id}/worktrees/remove`, { path, confirmed: true }, gitTimeout)
      .then((r) => r.data),
  previewNewFileDeletion: (id: string, path: string): Promise<NewFileDeletionPreview> =>
    api
      .post(`/repositories/${id}/delete-new-file/preview`, { path }, { timeout: 60000 })
      .then((r) => r.data),
  deleteNewFile: (id: string, path: string, token: string) =>
    api
      .post(`/repositories/${id}/delete-new-file`, { path, token }, { timeout: 60000 })
      .then((r) => r.data),
  stage: (id: string, files: string[]) =>
    api.post(`/repositories/${id}/stage`, { files }, gitTimeout).then((r) => r.data),
  unstage: (id: string, files: string[]) =>
    api.post(`/repositories/${id}/unstage`, { files }, gitTimeout).then((r) => r.data),
  commit: (id: string, message: string, description?: string) =>
    api
      .post(`/repositories/${id}/commit`, { message, description }, gitTimeout)
      .then((r) => r.data),
  push: (
    id: string,
    remote?: string,
    branch?: string,
    force?: boolean,
    setUpstream?: boolean,
    tags?: boolean,
  ) =>
    api
      .post(`/repositories/${id}/push`, { remote, branch, force, setUpstream, tags }, gitTimeout)
      .then((r) => r.data),
  pull: (id: string, remote?: string, branch?: string) =>
    api.post(`/repositories/${id}/pull`, { remote, branch }, gitTimeout).then((r) => r.data),
  fetch: (id: string, remote?: string) =>
    api.post(`/repositories/${id}/fetch`, { remote }, gitTimeout).then((r) => r.data),
  createBranch: (id: string, name: string, checkout?: boolean) =>
    api.post(`/repositories/${id}/branch`, { name, checkout }, gitTimeout).then((r) => r.data),
  switchBranch: (id: string, name: string) =>
    api.post(`/repositories/${id}/switch`, { name }, gitTimeout).then((r) => r.data),
  deleteBranch: (id: string, name: string, force?: boolean) =>
    api.post(`/repositories/${id}/branch/delete`, { name, force }, gitTimeout).then((r) => r.data),
  merge: (id: string, branch: string) =>
    api.post(`/repositories/${id}/merge`, { branch }, gitTimeout).then((r) => r.data),
  rebase: (id: string, branch: string) =>
    api.post(`/repositories/${id}/rebase`, { branch }, gitTimeout).then((r) => r.data),
  stash: (id: string, message?: string, includeUntracked?: boolean) =>
    api
      .post(`/repositories/${id}/stash`, { message, includeUntracked }, gitTimeout)
      .then((r) => r.data),
  stashPop: (id: string, index?: number) =>
    api.post(`/repositories/${id}/stash/pop`, { index }, gitTimeout).then((r) => r.data),
  stashApply: (id: string, index?: number) =>
    api.post(`/repositories/${id}/stash/apply`, { index }, gitTimeout).then((r) => r.data),
  stashDrop: (id: string, index?: number) =>
    api.post(`/repositories/${id}/stash/drop`, { index }, gitTimeout).then((r) => r.data),
  checkout: (id: string, files: string[]) =>
    api.post(`/repositories/${id}/checkout`, { files }, gitTimeout).then((r) => r.data),
  reset: (id: string, mode: string, commit?: string) =>
    api.post(`/repositories/${id}/reset`, { mode, commit }, gitTimeout).then((r) => r.data),
  cherryPick: (id: string, commits: string[]) =>
    api.post(`/repositories/${id}/cherry-pick`, { commits }, gitTimeout).then((r) => r.data),
  revert: (id: string, commit: string) =>
    api.post(`/repositories/${id}/revert`, { commit }, gitTimeout).then((r) => r.data),
};

// File APIs
export const fileApi = {
  list: (connectionId: string, path: string) =>
    api.get('/files/list', { params: { connectionId, path } }).then((r) => r.data),
  read: (connectionId: string, path: string) =>
    api.get('/files/read', { params: { connectionId, path } }).then((r) => r.data),
  write: (connectionId: string, path: string, content: string) =>
    api.post('/files/write', { connectionId, path, content }).then((r) => r.data),
};
