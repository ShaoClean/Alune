import { create } from 'zustand';
import type { BackgroundPullTarget } from '../api/agent-workspace';

export type BackgroundFetchState = {
  phase: 'fetching' | 'paused' | 'error' | 'success';
  reason?: string;
  checkedAt?: number;
};

export const useBackgroundSyncStore = create<{
  fetchStates: Record<string, BackgroundFetchState>;
  pendingPull?: { id: string; repositoryId: string; target: BackgroundPullTarget };
}>()(() => ({ fetchStates: {} }));
