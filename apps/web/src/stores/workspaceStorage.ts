import { create } from 'zustand';
import type { StateStorage } from 'zustand/middleware';

export interface WorkspaceBridge {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  clear: () => Promise<void>;
}

declare global {
  interface Window { remoteGitWorkspace?: WorkspaceBridge }
}

export const useWorkspaceStorageStatus = create<{ error: string | null }>(() => ({ error: null }));

function report(error: string | null) {
  useWorkspaceStorageStatus.setState({ error });
}

function validJSON(value: string | null): string | null {
  if (value === null) return null;
  try { JSON.parse(value); return value; } catch { return null; }
}

// Desktop storage has a stable location even though its HTTP port changes each launch.
export function createWorkspaceStorage(
  bridge: WorkspaceBridge | undefined = typeof window === 'undefined' ? undefined : window.remoteGitWorkspace,
): StateStorage {
  return {
    getItem: async (name) => {
      try {
        return validJSON(bridge ? await bridge.load() : localStorage.getItem(name));
      } catch {
        report('无法读取工作区设置，已使用默认值');
        return null;
      }
    },
    setItem: async (name, value) => {
      try {
        if (bridge) await bridge.save(value);
        else localStorage.setItem(name, value);
        report(null);
      } catch {
        report('工作区设置保存失败，本次调整可能无法在重启后保留');
      }
    },
    removeItem: async (name) => {
      try {
        if (bridge) await bridge.clear();
        else localStorage.removeItem(name);
        report(null);
      } catch {
        report('工作区设置清除失败，请重试');
      }
    },
  };
}
