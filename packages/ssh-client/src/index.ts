export { SSHConnection, SSHConnectionPool, parseSSHConfig } from './connection-manager';
export type { SSHConnectionOptions, CommandResult, StreamCallbacks } from './connection-manager';
export { GitCommands } from './git-commands';
export { GitWorktrees, worktreePathKey } from './worktrees';
export { StagedChanges, StagedChangesError, AI_DIFF_MAX_BYTES } from './staged-changes';
export { NewFileDeletion, NewFileDeletionError, validateNewFilePath } from './new-file-deletion';
export { DiffImages, DiffImageError, DiffImageAbsentError } from './diff-images';

export { GitLogChangedError, GitLogOptionsError } from './git-log';
