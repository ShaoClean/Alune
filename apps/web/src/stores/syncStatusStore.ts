import { create } from 'zustand';

export type SyncOperation = 'fetch' | 'pull' | 'push';

export interface SyncState {
  repoId: string | null;
  operation: SyncOperation | null;
  force: boolean;
  detail: string | null;
}

interface SyncStatusState extends SyncState {
  startSync: (repoId: string, operation: SyncOperation, options?: { force?: boolean }) => void;
  finishSync: (repoId: string) => void;
}

const idle: SyncState = { repoId: null, operation: null, force: false, detail: null };

const operationLabels: Record<SyncOperation, string> = {
  fetch: '获取',
  pull: '拉取',
  push: '推送',
};

// The toolbar button and the status bar read the same running operation, so both places
// describe the command in flight instead of only the button the user clicked.
export function syncDetail(operation: SyncOperation, force = false) {
  if (operation === 'fetch') return '正在从 origin 获取更新…';
  if (operation === 'pull') return '正在从 origin 拉取…';
  return force ? '正在强制推送到 origin…' : '正在推送到 origin…';
}

export function syncLabel(operation: SyncOperation) {
  return operationLabels[operation];
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  ...idle,
  startSync: (repoId, operation, options) =>
    set({
      repoId,
      operation,
      force: Boolean(options?.force),
      detail: syncDetail(operation, options?.force),
    }),
  // Only the workspace that started the operation may clear it.
  finishSync: (repoId) =>
    set((state) => (state.repoId === repoId ? { ...idle } : state)),
}));
