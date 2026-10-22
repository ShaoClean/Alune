import { useFeedbackMessage } from '@alune/ui';
import { useRef, useState } from 'react';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

// Both branch entry points share the same switch and refresh behavior.
export function useBranchSwitch(repoId: string, onSwitched: () => void) {
  const message = useFeedbackMessage();
  const pending = useRef(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const switchBranch = async (name: string, isRemote?: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setSwitching(name);
    try {
      try {
        await gitApi.switchBranch(repoId, name, undefined, isRemote);
      } catch (error: any) {
        const conflict = error.response?.data;
        if (conflict?.code !== 'LOCAL_BRANCH_EXISTS') throw error;
        // A same-named local branch already exists: switch to it instead of asking.
        await gitApi.switchBranch(repoId, conflict.localName, undefined, false);
      }
      const store = useRepositoryStore.getState();
      await Promise.all([store.fetchBranches(repoId), store.fetchLog(repoId)]);
      onSwitched();
    } catch (error: any) {
      message.error(error.message || '无法切换分支');
    } finally {
      pending.current = false;
      setSwitching(null);
    }
  };
  return { switching, switchBranch };
}
