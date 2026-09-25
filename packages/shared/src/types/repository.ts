export interface Repository {
  id: string;
  connectionId: string;
  name: string;
  path: string;
  currentBranch?: string;
  ahead?: number;
  behind?: number;
  isDirty?: boolean;
  lastCommit?: CommitInfo;
}

export interface RepositoryStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: FileStatus[];
}

export interface WorktreeInfo {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  prunableReason?: string;
  isCurrent: boolean;
}

// The server bounds SSH + Git work; the client allows a little time for transport.
export const REPOSITORY_STATUS_TIMEOUT_MS = 10_000;
export const REPOSITORY_STATUS_REQUEST_TIMEOUT_MS = 12_000;
export const REPOSITORY_STATUS_CACHE_MS = 60_000;

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  email: string;
  date: Date;
  refs?: string[];
}

export interface CommitReference {
  name: string;
  fullName: string;
  kind: 'local' | 'remote' | 'tag' | 'head' | 'other';
  current?: boolean;
}

export interface GraphCommit extends CommitInfo {
  parents: string[];
  references: CommitReference[];
}

export interface LogPage {
  commits: GraphCommit[];
  hasMore: boolean;
  nextSkip: number;
  revision: string;
  shallow: boolean;
}

export interface CommitFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions?: number;
  deletions?: number;
}

export interface FileStatus {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored';
  staged: boolean;
  additions?: number;
  deletions?: number;
}

export interface NewFileDeletionPreview {
  path: string;
  token: string;
  staged: boolean;
  hasUnstagedChanges: boolean;
  diskPresent: boolean;
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: CommitInfo;
}

export interface StashEntry {
  index: number;
  message: string;
  branch?: string;
  date?: Date;
}

export interface DiffOptions {
  file?: string;
  staged?: boolean;
  commit?: string;
  parentCommit?: string;
}

export type DiffImageSide = 'before' | 'after';

export interface DiffImageOptions extends DiffOptions {
  file: string;
  side: DiffImageSide;
}

export interface DiffImageContent {
  path: string;
  side: DiffImageSide;
  mediaType: string;
  byteLength: number;
  // Base64 payload; the page renders it as a data URL without a second request.
  content: string;
}

// Browser-renderable formats only. Other binaries keep the existing notice.
export const DIFF_IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const DIFF_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function diffImageMediaType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return DIFF_IMAGE_MEDIA_TYPES[name.slice(dot + 1).toLowerCase()] || null;
}

// Read-only worktree browsing. Paths are repository-relative and '/'-separated;
// the root directory is ''. Links and nested repositories are never followed.
export type RepositoryTreeEntryKind = 'directory' | 'file' | 'symlink' | 'submodule' | 'other';

export interface RepositoryTreeEntry {
  name: string;
  path: string;
  kind: RepositoryTreeEntryKind;
  size?: number;
  // Symlink target as stored in the link, shown but not resolved.
  target?: string;
}

export interface RepositoryTreeListing {
  path: string;
  entries: RepositoryTreeEntry[];
  // Entries in the directory before truncation, excluding the hidden .git.
  total: number;
  truncated: boolean;
}

export type RepositoryFilePreview =
  | {
      path: string;
      kind: 'text';
      size: number;
      encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
      content: string;
    }
  | { path: string; kind: 'image'; size: number; mediaType: string; content: string }
  | { path: string; kind: 'binary'; size: number }
  | { path: string; kind: 'too-large'; size: number; limit: number }
  | { path: string; kind: 'unsupported-encoding'; size: number }
  | { path: string; kind: 'symlink'; target: string }
  | { path: string; kind: 'other' };

export const REPOSITORY_TREE_MAX_ENTRIES = 5000;
export const REPOSITORY_TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export interface LogOptions {
  branch?: string;
  file?: string;
  author?: string;
  search?: string;
  count?: number;
  skip?: number;
  revision?: string;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}
