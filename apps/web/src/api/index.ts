import type { LfsStatus, SubmoduleInfo } from '@alune/domain';
import type {
  PullRequestAccount,
  PullRequestCenterQuery,
  PullRequestCenterPage,
  PullRequestSources,
  PullRequestCreationQuery,
  PullRequestCreationPreview,
  CreatePullRequest,
  CreatedPullRequest,
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
} from '@alune/protocol';
import type {
  SigningConfig,
  CommitSignature,
  PartialDiffRequest,
  BlameOptions,
  BlameResult,
  BlameCommitDetail,
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
} from '@alune/domain';

// Public API signatures are installed by installWorkspaceAgent before mounting.
// Uninstalled calls reject; there is no alternate transport or executor.
export const accessTokenApi = {
  list: (): Promise<AccessTokenSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 accessTokenApi.list。')),
  save: (_id: string | null, _body: SaveAccessToken): Promise<AccessTokenSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 accessTokenApi.save。')),
  delete: (_id: string, _revision: string): Promise<AccessTokenSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 accessTokenApi.delete。')),
};

// Connection APIs
export const connectionApi = {
  list: (): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 connectionApi.list。')),
  get: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 connectionApi.get。')),
  create: (_data: any): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 connectionApi.create。')),
  delete: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 connectionApi.delete。')),
  test: (_id: string): Promise<ConnectionTestResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 connectionApi.test。')),
};

// Repository APIs
export const repositoryApi = {
  analytics: (
    _ids: string[],
    _collect = false,
    _refresh = false,
    _signal?: AbortSignal,
  ): Promise<RepositoryAnalyticsEntry[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.analytics。')),
  applyAccessToken: (_id: string, _body: ApplyAccessToken): Promise<AccessTokenSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.applyAccessToken。')),
  previewPullRequest: (
    _id: string,
    _query: PullRequestCreationQuery,
    _signal?: AbortSignal,
  ): Promise<PullRequestCreationPreview> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.previewPullRequest。')),
  createPullRequest: (_id: string, _query: CreatePullRequest): Promise<CreatedPullRequest> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.createPullRequest。')),
  pullRequestRemotes: (_id: string, _signal?: AbortSignal): Promise<PullRequestRemote[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pullRequestRemotes。')),
  pullRequests: (
    _id: string,
    _query: PullRequestQuery,
    _signal?: AbortSignal,
  ): Promise<PullRequestPage> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pullRequests。')),
  pullRequestDetail: (
    _id: string,
    _query: PullRequestDetailQuery,
    _signal?: AbortSignal,
  ): Promise<PullRequestDetail> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pullRequestDetail。')),
  pullRequestFiles: (
    _id: string,
    _query: PullRequestResourceQuery,
    _signal?: AbortSignal,
  ): Promise<PullRequestResourcePage<PullRequestFile>> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pullRequestFiles。')),
  pullRequestDiscussions: (
    _id: string,
    _query: PullRequestDiscussionQuery,
    _signal?: AbortSignal,
  ): Promise<PullRequestResourcePage<PullRequestDiscussion>> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pullRequestDiscussions。')),
  pullRequestActions: (
    _id: string,
    _query: PullRequestDetailQuery,
    _signal?: AbortSignal,
  ): Promise<PullRequestActions> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pullRequestActions。')),
  mutatePullRequest: (
    _id: string,
    _query: PullRequestMutation,
  ): Promise<PullRequestMutationResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.mutatePullRequest。')),
  inspectLocal: (
    _path: string,
  ): Promise<RepositoryContext & { name: string; status: RepositoryStatus }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.inspectLocal。')),
  addLocal: (_path: string): Promise<Repository> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.addLocal。')),
  context: (_id: string, _signal?: AbortSignal): Promise<RepositoryContext> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.context。')),
  submodules: (_id: string, _signal?: AbortSignal): Promise<SubmoduleInfo[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.submodules。')),
  lfs: (_id: string, _signal?: AbortSignal): Promise<LfsStatus> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.lfs。')),
  openSubmodule: (_id: string, _path: string): Promise<Repository> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.openSubmodule。')),
  worktrees: (_id: string, _signal?: AbortSignal): Promise<WorktreeInfo[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.worktrees。')),
  openWorktree: (_id: string, _path: string): Promise<Repository> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.openWorktree。')),
  scan: (_connectionId: string, _path: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.scan。')),
  add: (_connectionId: string, _path: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.add。')),
  list: (_connectionId?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.list。')),
  get: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.get。')),
  delete: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.delete。')),
  pin: (_id: string, _pinned: boolean): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.pin。')),
  status: (_id: string, _signal?: AbortSignal, _foreground = false): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.status。')),
  log: (_id: string, _params?: LogOptions, _signal?: AbortSignal): Promise<LogPage> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.log。')),
  commitFiles: (_id: string, _commit: string, _parentCommit?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.commitFiles。')),
  diff: (_id: string, _params?: any, _signal?: AbortSignal): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.diff。')),
  diffImage: (
    _id: string,
    _params: DiffImageOptions,
    _signal?: AbortSignal,
  ): Promise<DiffImageContent> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.diffImage。')),
  // Read-only worktree browsing; '' is the repository root.
  tree: (_id: string, _path: string, _signal?: AbortSignal): Promise<RepositoryTreeListing> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.tree。')),
  file: (_id: string, _path: string, _signal?: AbortSignal): Promise<RepositoryFilePreview> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.file。')),
  blame: (_id: string, _params: BlameOptions, _signal?: AbortSignal): Promise<BlameResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.blame。')),
  blameCommit: (_id: string, _commit: string, _signal?: AbortSignal): Promise<BlameCommitDetail> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.blameCommit。')),
  branches: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.branches。')),
  stashes: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.stashes。')),
  remotes: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 repositoryApi.remotes。')),
};

// Git Operation APIs
export const gitApi = {
  signingConfig: (_id: string, _signal?: AbortSignal): Promise<SigningConfig> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.signingConfig。')),
  saveSigningConfig: (_id: string, _config: SigningConfig): Promise<SigningConfig> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.saveSigningConfig。')),
  signatures: (_id: string, _hashes: string[], _signal?: AbortSignal): Promise<CommitSignature[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.signatures。')),
  tags: (_id: string): Promise<GitTag[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.tags。')),
  remoteTags: (_id: string, _remote: string): Promise<RemoteTag[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.remoteTags。')),
  createTag: (_id: string, _options: CreateTagOptions): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.createTag。')),
  deleteTag: (_id: string, _options: DeleteTagOptions): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.deleteTag。')),
  pushTag: (_id: string, _options: PushTagOptions): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.pushTag。')),
  checkoutTag: (_id: string, _options: CheckoutTagOptions): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.checkoutTag。')),
  previewRebase: (_id: string, _base: string): Promise<RebasePreview> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.previewRebase。')),
  rebaseState: (_id: string): Promise<RebaseState> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.rebaseState。')),
  startRebase: (_id: string, _request: RebaseRequest): Promise<RebaseResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.startRebase。')),
  controlRebase: (_id: string, _action: 'continue' | 'skip' | 'abort'): Promise<RebaseResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.controlRebase。')),
  rebaseConflict: (_id: string, _path: string): Promise<RebaseConflict> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.rebaseConflict。')),
  resolveRebaseConflict: (_id: string, _request: RebaseResolution): Promise<RebaseState> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.resolveRebaseConflict。')),
  ignoreDirectory: (_id: string, _path: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.ignoreDirectory。')),
  submodules: (_id: string, _action: 'update' | 'sync'): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.submodules。')),
  operation: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.operation。')),
  cancel: (_id: string, _operationId?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.cancel。')),
  deepen: (_id: string, _remote?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.deepen。')),
  renameBranch: (_id: string, _name: string, _newName: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.renameBranch。')),
  stashShow: (_id: string, _index: number): Promise<{ diff: string }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.stashShow。')),
  addRemote: (_id: string, _name: string, _url: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.addRemote。')),
  saveAuthor: (_id: string, _name: string, _email: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.saveAuthor。')),
  createWorktree: (_id: string, _path: string, _branch: string): Promise<Repository> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.createWorktree。')),
  removeWorktree: (_id: string, _path: string): Promise<{ removedIds: string[] }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.removeWorktree。')),
  previewWorkspaceFile: (_id: string, _path: string): Promise<WorkspaceFilePreview> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.previewWorkspaceFile。')),
  mutateWorkspaceFile: (
    _id: string,
    _path: string,
    _token: string,
    _action: 'delete' | 'rename',
    _name?: string,
  ): Promise<{ success: true; newPath?: string }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.mutateWorkspaceFile。')),
  previewNewFileDeletion: (_id: string, _path: string): Promise<NewFileDeletionPreview> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.previewNewFileDeletion。')),
  deleteNewFile: (_id: string, _path: string, _token: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.deleteNewFile。')),
  partialDiff: (_id: string, _request: PartialDiffRequest): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.partialDiff。')),
  stage: (_id: string, _files: string[]): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.stage。')),
  unstage: (_id: string, _files: string[]): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.unstage。')),
  commit: (_id: string, _message: string, _description?: string, _amend?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.commit。')),
  push: (
    _id: string,
    _remote?: string,
    _branch?: string,
    _force?: boolean,
    _setUpstream?: boolean,
    _tags?: boolean,
  ): Promise<any> => Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.push。')),
  pull: (_id: string, _remote?: string, _branch?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.pull。')),
  fetch: (_id: string, _remote?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.fetch。')),
  createBranch: (_id: string, _name: string, _checkout?: boolean): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.createBranch。')),
  switchBranch: (
    _id: string,
    _name: string,
    _localName?: string,
    _isRemote?: boolean,
  ): Promise<SwitchBranchResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.switchBranch。')),
  deleteBranch: (_id: string, _name: string, _force?: boolean): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.deleteBranch。')),
  merge: (_id: string, _branch: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.merge。')),
  rebase: (_id: string, _branch: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.rebase。')),
  stash: (_id: string, _message?: string, _includeUntracked?: boolean): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.stash。')),
  stashPop: (_id: string, _index?: number): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.stashPop。')),
  stashApply: (_id: string, _index?: number): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.stashApply。')),
  stashDrop: (_id: string, _index?: number): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.stashDrop。')),
  checkout: (_id: string, _files: string[]): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.checkout。')),
  previewDiscardChanges: (_id: string): Promise<DiscardChangesPreview> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.previewDiscardChanges。')),
  discardChanges: (
    _id: string,
    _token: string,
    _scope: DiscardChangesScope,
  ): Promise<DiscardChangesResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.discardChanges。')),
  reset: (_id: string, _mode: string, _commit?: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.reset。')),
  cherryPick: (_id: string, _commits: string[]): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.cherryPick。')),
  revert: (_id: string, _commit: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.revert。')),
  continueOperation: (_id: string): Promise<ConflictStepResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.continueOperation。')),
  skipOperation: (_id: string): Promise<ConflictStepResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.skipOperation。')),
  abortOperation: (_id: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.abortOperation。')),
  resolveConflictFile: (_id: string, _file: string, _side: ConflictSide): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.resolveConflictFile。')),
  resolveConflictBlock: (
    _id: string,
    _file: string,
    _index: number,
    _choice: ConflictBlockChoice,
    _expected: string,
  ): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 gitApi.resolveConflictBlock。')),
};

// File APIs
export const fileApi = {
  list: (_connectionId: string, _path: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 fileApi.list。')),
  read: (_connectionId: string, _path: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 fileApi.read。')),
  write: (_connectionId: string, _path: string, _content: string): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 fileApi.write。')),
};

export const pullRequestCenterApi = {
  context: async (
    _repositoryId: string,
    _query: PullRequestQuery,
    _signal?: AbortSignal,
  ): Promise<{ account: PullRequestAccount | null; identityNotice?: string }> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 pullRequestCenterApi.context。')),
  sources: async (_cursor?: string, _signal?: AbortSignal): Promise<PullRequestSources> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 pullRequestCenterApi.sources。')),
  list: async (
    _input: { discoveryId?: string; query?: PullRequestCenterQuery; cursor?: string },
    _signal?: AbortSignal,
  ): Promise<PullRequestCenterPage> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 pullRequestCenterApi.list。')),
};
