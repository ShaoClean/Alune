export { SSHConnection, SSHConnectionPool, parseSSHConfig } from './connection-manager';
export type { SSHConnectionOptions, CommandResult, StreamCallbacks } from './connection-manager';
export { GitCommands } from './git-commands';
export { GitTags } from './git-tags';
export { InteractiveRebase } from './interactive-rebase';
export { assertFileChanges, ignoreDirectory } from './change-entries';
export { GitWorktrees, worktreePathKey } from './worktrees';
export { StagedChanges, StagedChangesError, AI_DIFF_MAX_BYTES } from './staged-changes';
export { NewFileDeletion, NewFileDeletionError, validateNewFilePath } from './new-file-deletion';
export {
  DiscardChanges,
  DiscardChangesError,
  validateDiscardChangesRequest,
} from './discard-changes';
export { DiffImages, DiffImageError, DiffImageAbsentError } from './diff-images';

export { GitLogChangedError, GitLogOptionsError } from './git-log';
export {
  RepositoryFiles,
  RepositoryFileError,
  validateRepositoryPath,
  decodeTextPreview,
} from './repository-files';

export { LocalConnection } from './local-connection';
export { runGit } from './repository-transport';
export type { RepositoryTransport, CommandOptions } from './repository-transport';
export {
  connectProxySocket,
  createProxyDispatcher,
  createProxyBridge,
  ProxyTransportError,
} from './proxy-transport';
export type { ProxySnapshot } from './proxy-transport';
export { GitProxyError } from './proxy-git';
export { WorkspaceFileActions, validateWorkspaceName } from './workspace-file-actions';
export { collectRepositoryAnalytics, primaryLanguage } from './repository-analytics';
export { ConflictResolution, ConflictResolutionError } from './conflict-resolution';
