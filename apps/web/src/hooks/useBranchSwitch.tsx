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
    let notice: string | undefined;
    try {
      try {
        await gitApi.switchBranch(repoId, name, undefined, isRemote);
      } catch (error: any) {
        const conflict = error.response?.data;
        if (conflict?.code !== 'LOCAL_BRANCH_EXISTS') throw error;
        // A same-named local branch already exists: switch to it instead of asking,
        // but say so, since its history may differ from the remote branch picked.
        await gitApi.switchBranch(repoId, conflict.localName, undefined, false);
        const remote = name.replace(/^remotes\//, '');
        const upstream = conflict.upstream?.replace(/^refs\/remotes\//, '');
        notice = `已切换到现有本地分支“${conflict.localName}”，它未跟踪 ${remote}${
          upstream ? `（当前跟踪 ${upstream}）` : ''
        }。`;
      }
      const store = useRepositoryStore.getState();
      await Promise.all([store.fetchBranches(repoId), store.fetchLog(repoId)]);
      onSwitched();
      if (notice) message.info(notice);
    } catch (error: any) {
      message.error(error.message || '无法切换分支');
    } finally {
      pending.current = false;
      setSwitching(null);
    }
  };
  return { switching, switchBranch };
}
