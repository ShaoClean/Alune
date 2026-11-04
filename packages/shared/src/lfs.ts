export { parseLfsPointer } from '@alune/domain';
export type { LfsPointer } from '@alune/domain';

export interface LfsStatus {
  used: boolean;
  installed: boolean;
  version?: string;
  message?: string;
}

// Bounded attribute batches need multiple SSH round trips. Finish before the
// API client's 30-second request deadline, including connection setup.
export const LFS_STATUS_TIMEOUT_MS = 25_000;

export interface SubmoduleInfo {
  path: string;
  recordedCommit: string;
  currentCommit: string | null;
  initialized: boolean;
  dirty: boolean;
  status: 'uninitialized' | 'current' | 'changed' | 'conflict';
}
