import axios from 'axios';
import { REPOSITORY_STATUS_REQUEST_TIMEOUT_MS } from '@remote-git/shared';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Connection APIs
export const connectionApi = {
  list: () => api.get('/connections').then((r) => r.data),
  get: (id: string) => api.get(`/connections/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/connections', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/connections/${id}`).then((r) => r.data),
  test: (id: string) => api.post(`/connections/${id}/test`).then((r) => r.data),
};

// Repository APIs
export const repositoryApi = {
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
    api.get(`/repositories/${id}/status`, {
      signal,
      timeout: REPOSITORY_STATUS_REQUEST_TIMEOUT_MS,
    }).then((r) => r.data),
  log: (id: string, params?: any) =>
    api.get(`/repositories/${id}/log`, { params }).then((r) => r.data),
  commitFiles: (id: string, commit: string, parentCommit?: string) =>
    api.get(`/repositories/${id}/commit-files`, { params: { commit, parentCommit } }).then((r) => r.data),
  diff: (id: string, params?: any) =>
    api.get(`/repositories/${id}/diff`, { params }).then((r) => r.data),
  branches: (id: string) => api.get(`/repositories/${id}/branches`).then((r) => r.data),
  stashes: (id: string) => api.get(`/repositories/${id}/stashes`).then((r) => r.data),
  remotes: (id: string) => api.get(`/repositories/${id}/remotes`).then((r) => r.data),
};

// Git Operation APIs
export const gitApi = {
  stage: (id: string, files: string[]) =>
    api.post(`/repositories/${id}/stage`, { files }).then((r) => r.data),
  unstage: (id: string, files: string[]) =>
    api.post(`/repositories/${id}/unstage`, { files }).then((r) => r.data),
  commit: (id: string, message: string, description?: string) =>
    api.post(`/repositories/${id}/commit`, { message, description }).then((r) => r.data),
  push: (id: string, remote?: string, branch?: string, force?: boolean) =>
    api.post(`/repositories/${id}/push`, { remote, branch, force }).then((r) => r.data),
  pull: (id: string, remote?: string, branch?: string) =>
    api.post(`/repositories/${id}/pull`, { remote, branch }).then((r) => r.data),
  fetch: (id: string, remote?: string) =>
    api.post(`/repositories/${id}/fetch`, { remote }).then((r) => r.data),
  createBranch: (id: string, name: string, checkout?: boolean) =>
    api.post(`/repositories/${id}/branch`, { name, checkout }).then((r) => r.data),
  switchBranch: (id: string, name: string) =>
    api.post(`/repositories/${id}/switch`, { name }).then((r) => r.data),
  deleteBranch: (id: string, name: string, force?: boolean) =>
    api.post(`/repositories/${id}/branch/delete`, { name, force }).then((r) => r.data),
  merge: (id: string, branch: string) =>
    api.post(`/repositories/${id}/merge`, { branch }).then((r) => r.data),
  rebase: (id: string, branch: string) =>
    api.post(`/repositories/${id}/rebase`, { branch }).then((r) => r.data),
  stash: (id: string, message?: string) =>
    api.post(`/repositories/${id}/stash`, { message }).then((r) => r.data),
  stashPop: (id: string, index?: number) =>
    api.post(`/repositories/${id}/stash/pop`, { index }).then((r) => r.data),
  stashApply: (id: string, index?: number) =>
    api.post(`/repositories/${id}/stash/apply`, { index }).then((r) => r.data),
  stashDrop: (id: string, index?: number) =>
    api.post(`/repositories/${id}/stash/drop`, { index }).then((r) => r.data),
  checkout: (id: string, files: string[]) =>
    api.post(`/repositories/${id}/checkout`, { files }).then((r) => r.data),
  reset: (id: string, mode: string, commit?: string) =>
    api.post(`/repositories/${id}/reset`, { mode, commit }).then((r) => r.data),
  cherryPick: (id: string, commits: string[]) =>
    api.post(`/repositories/${id}/cherry-pick`, { commits }).then((r) => r.data),
  revert: (id: string, commit: string) =>
    api.post(`/repositories/${id}/revert`, { commit }).then((r) => r.data),
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
