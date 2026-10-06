import axios from 'axios';
import { confirmTerminalRemoval } from '../stores/terminalRemoval';
import { REPOSITORY_STATUS_REQUEST_TIMEOUT_MS } from '@alune/shared';
import type {
  ConnectionTestResult,
  DiffImageContent,
  DiffImageOptions,
  NewFileDeletionPreview,
  WorkspaceFilePreview,
  DiscardChangesPreview,
  DiscardChangesResult,
  DiscardChangesScope,
  LogOptions,
  LogPage,
  Repository,
  RepositoryContext,
  RepositoryStatus,
  RepositoryAnalyticsEntry,
  RepositoryFilePreview,
  RepositoryTreeListing,
  WorktreeInfo,
  PullRequestRemote,
  PullRequestQuery,
  PullRequestPage,
  PullRequestDetail,
  PullRequestDetailQuery,
  PullRequestResourceQuery,
  PullRequestDiscussionQuery,
  PullRequestDiscussion,
  PullRequestFile,
  PullRequestResourcePage,
  PullRequestActions,
  PullRequestMutation,
  PullRequestMutationResult,
  AccessTokenSettings,
  SaveAccessToken,
  ApplyAccessToken,
  SwitchBranchResult,
  GitTag,
  RemoteTag,
  CreateTagOptions,
  DeleteTagOptions,
  PushTagOptions,
  CheckoutTagOptions,
  RebasePreview,
  RebaseRequest,
  RebaseState,
  RebaseResult,
  RebaseConflict,
  RebaseResolution,
  ConflictBlockChoice,
  ConflictSide,
  ConflictStepResult,
} from '@alune/shared';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const impact = error.response?.data;
    if (
      error.config?.method === 'delete' &&
      impact?.code === 'TERMINAL_CONFIRM_REQUIRED' &&
      Array.isArray(impact.sessions) &&
      (await confirmTerminalRemoval(impact.sessions))
    ) {
      return api.request({
        ...error.config,
        data: { terminalSessionIds: impact.sessions.map((item: { id: string }) => item.id) },
      });
    }
    const detail = error.response?.data?.message;
    if (detail) error.message = Array.isArray(detail) ? detail.join('；') : String(detail);
    return Promise.reject(error);
  },
);
const gitTimeout = { timeout: 310_000 };

export const accessTokenApi = {
  list: (): Promise<AccessTokenSettings> => api.get('/access-tokens').then((r) => r.data),
  save: (id: string | null, body: SaveAccessToken): Promise<AccessTokenSettings> =>
    (id
      ? api.put(`/access-tokens/${encodeURIComponent(id)}`, body)
      : api.post('/access-tokens', body)
    ).then((r) => r.data),
  delete: (id: string, revision: string): Promise<AccessTokenSettings> =>
    api
      .delete(`/access-tokens/${encodeURIComponent(id)}`, { data: { revision } })
      .then((r) => r.data),
};

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
  analytics: (
    ids: string[],
    collect = false,
    refresh = false,
    signal?: AbortSignal,
  ): Promise<RepositoryAnalyticsEntry[]> =>
    api
      .post(
        '/repositories/analytics/summary',
        { ids, collect, refresh },
        { signal, timeout: 220000 },
      )
      .then((r) => r.data),
  applyAccessToken: (id: string, body: ApplyAccessToken): Promise<AccessTokenSettings> =>
    api.post(`/repositories/${id}/pull-requests/token`, body).then((r) => r.data),
  pullRequestRemotes: (id: string, signal?: AbortSignal): Promise<PullRequestRemote[]> =>
    api.get(`/repositories/${id}/pull-requests/remotes`, { signal }).then((r) => r.data),
  pullRequests: (
    id: string,
    query: PullRequestQuery,
    signal?: AbortSignal,
  ): Promise<PullRequestPage> =>
    api.post(`/repositories/${id}/pull-requests/list`, query, { signal }).then((r) => r.data),
  pullRequestDetail: (
    id: string,
    query: PullRequestDetailQuery,
    signal?: AbortSignal,
  ): Promise<PullRequestDetail> =>
    api.post(`/repositories/${id}/pull-requests/detail`, query, { signal }).then((r) => r.data),
  pullRequestFiles: (
    id: string,
    query: PullRequestResourceQuery,
    signal?: AbortSignal,
  ): Promise<PullRequestResourcePage<PullRequestFile>> =>
    api.post(`/repositories/${id}/pull-requests/files`, query, { signal }).then((r) => r.data),
  pullRequestDiscussions: (
    id: string,
    query: PullRequestDiscussionQuery,
    signal?: AbortSignal,
  ): Promise<PullRequestResourcePage<PullRequestDiscussion>> =>
    api
      .post(`/repositories/${id}/pull-requests/discussions`, query, { signal })
      .then((r) => r.data),
  pullRequestActions: (
    id: string,
    query: PullRequestDetailQuery,
    signal?: AbortSignal,
  ): Promise<PullRequestActions> =>
    api.post(`/repositories/${id}/pull-requests/actions`, query, { signal }).then((r) => r.data),
  mutatePullRequest: (id: string, query: PullRequestMutation): Promise<PullRequestMutationResult> =>
    api
      .post(`/repositories/${id}/pull-requests/mutate`, query, { timeout: 90_000 })
      .then((r) => r.data),
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
  tags: (id: string): Promise<GitTag[]> => api.get(`/repositories/${id}/tags`).then((r) => r.data),
  remoteTags: (id: string, remote: string): Promise<RemoteTag[]> =>
    api
      .get(`/repositories/${id}/tags/remote`, { params: { remote }, timeout: 35_000 })
      .then((r) => r.data),
  createTag: (id: string, options: CreateTagOptions) =>
    api.post(`/repositories/${id}/tags`, options, gitTimeout).then((r) => r.data),
  deleteTag: (id: string, options: DeleteTagOptions) =>
    api.post(`/repositories/${id}/tags/delete`, options, gitTimeout).then((r) => r.data),
  pushTag: (id: string, options: PushTagOptions) =>
    api.post(`/repositories/${id}/tags/push`, options, gitTimeout).then((r) => r.data),
  checkoutTag: (id: string, options: CheckoutTagOptions) =>
    api.post(`/repositories/${id}/tags/checkout`, options, gitTimeout).then((r) => r.data),
  previewRebase: (id: string, base: string): Promise<RebasePreview> =>
    api
      .post(`/repositories/${id}/interactive-rebase/preview`, { base }, { timeout: 65_000 })
      .then((r) => r.data),
  rebaseState: (id: string): Promise<RebaseState> =>
    api.get(`/repositories/${id}/interactive-rebase`).then((r) => r.data),
  startRebase: (id: string, request: RebaseRequest): Promise<RebaseResult> =>
    api.post(`/repositories/${id}/interactive-rebase`, request, gitTimeout).then((r) => r.data),
  controlRebase: (id: string, action: 'continue' | 'skip' | 'abort'): Promise<RebaseResult> =>
    api
      .post(`/repositories/${id}/interactive-rebase/control`, { action }, gitTimeout)
      .then((r) => r.data),
  rebaseConflict: (id: string, path: string): Promise<RebaseConflict> =>
    api
      .post(`/repositories/${id}/interactive-rebase/conflict`, { path }, { timeout: 65_000 })
      .then((r) => r.data),
  resolveRebaseConflict: (id: string, request: RebaseResolution): Promise<RebaseState> =>
    api
      .post(`/repositories/${id}/interactive-rebase/resolve`, request, gitTimeout)
      .then((r) => r.data),
  ignoreDirectory: (id: string, path: string) =>
    api.post(`/repositories/${id}/ignore-directory`, { path }, gitTimeout).then((r) => r.data),
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
  previewWorkspaceFile: (id: string, path: string): Promise<WorkspaceFilePreview> =>
    api.post(`/repositories/${id}/workspace-file/preview`, { path }).then((res) => res.data),
  mutateWorkspaceFile: (
    id: string,
    path: string,
    token: string,
    action: 'delete' | 'rename',
    name?: string,
  ): Promise<{ success: true; newPath?: string }> =>
    api
      .post(`/repositories/${id}/workspace-file`, { path, token, action, name })
      .then((res) => res.data),
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
  switchBranch: (
    id: string,
    name: string,
    localName?: string,
    isRemote?: boolean,
  ): Promise<SwitchBranchResult> =>
    api
      .post(`/repositories/${id}/switch`, { name, localName, isRemote }, gitTimeout)
      .then((r) => r.data),
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
  previewDiscardChanges: (id: string): Promise<DiscardChangesPreview> =>
    api
      .post(`/repositories/${id}/discard-changes/preview`, {}, { timeout: 65_000 })
      .then((r) => r.data),
  discardChanges: (
    id: string,
    token: string,
    scope: DiscardChangesScope,
  ): Promise<DiscardChangesResult> =>
    api
      .post(`/repositories/${id}/discard-changes`, { token, scope }, gitTimeout)
      .then((r) => r.data),
  reset: (id: string, mode: string, commit?: string) =>
    api.post(`/repositories/${id}/reset`, { mode, commit }, gitTimeout).then((r) => r.data),
  cherryPick: (id: string, commits: string[]) =>
    api.post(`/repositories/${id}/cherry-pick`, { commits }, gitTimeout).then((r) => r.data),
  revert: (id: string, commit: string) =>
    api.post(`/repositories/${id}/revert`, { commit }, gitTimeout).then((r) => r.data),
  continueOperation: (id: string): Promise<ConflictStepResult> =>
    api.post(`/repositories/${id}/conflicts/continue`, {}, gitTimeout).then((r) => r.data),
  skipOperation: (id: string): Promise<ConflictStepResult> =>
    api.post(`/repositories/${id}/conflicts/skip`, {}, gitTimeout).then((r) => r.data),
  abortOperation: (id: string) =>
    api.post(`/repositories/${id}/conflicts/abort`, {}, gitTimeout).then((r) => r.data),
  resolveConflictFile: (id: string, file: string, side: ConflictSide) =>
    api
      .post(`/repositories/${id}/conflicts/resolve-file`, { file, side }, gitTimeout)
      .then((r) => r.data),
  resolveConflictBlock: (
    id: string,
    file: string,
    index: number,
    choice: ConflictBlockChoice,
    expected: string,
  ) =>
    api
      .post(
        `/repositories/${id}/conflicts/resolve-block`,
        { file, index, choice, expected },
        gitTimeout,
      )
      .then((r) => r.data),
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
