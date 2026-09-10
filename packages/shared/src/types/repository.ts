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

export interface LogOptions {
  branch?: string;
  file?: string;
  author?: string;
  search?: string;
  count?: number;
  skip?: number;
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}
