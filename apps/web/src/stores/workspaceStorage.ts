import { create } from 'zustand';
import type { StateStorage } from 'zustand/middleware';

export interface WorkspaceBridge {
  chooseDirectory?: () => Promise<string | null>;
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  clear: () => Promise<void>;
}

declare global {
  interface Window {
    aluneWorkspace?: WorkspaceBridge;
  }
}

export const useWorkspaceStorageStatus = create<{ error: string | null }>(() => ({ error: null }));

function report(error: string | null) {
  useWorkspaceStorageStatus.setState({ error });
}

function validJSON(value: string | null): string | null {
  if (value === null) return null;
  try {
    JSON.parse(value);
    return value;
  } catch {
    return null;
  }
}

let owner: string | undefined;
export function scopeBrowserWorkspace(agentId: string) {
  owner = agentId;
}
const scoped = (name: string) => (owner ? name + ':' + owner : name);
function readBrowser(name: string) {
  const destination = scoped(name),
    saved = localStorage.getItem(destination);
  if (saved !== null || !owner) return saved;
  const migrated = name + ':legacy-owner';
  if (localStorage.getItem(migrated) !== null) return null;
  const legacy = validJSON(localStorage.getItem(name));
  if (legacy !== null) localStorage.setItem(destination, legacy);
  localStorage.setItem(migrated, owner);
  return legacy;
}

// Desktop storage has a stable location even though its HTTP port changes each launch.
export function createWorkspaceStorage(
  bridge: WorkspaceBridge | undefined = typeof window === 'undefined'
    ? undefined
    : window.aluneWorkspace,
): StateStorage {
  return {
    getItem: async (name) => {
      try {
        return validJSON(bridge ? await bridge.load() : readBrowser(name));
      } catch {
        report('无法读取工作区设置，已使用默认值');
        return null;
      }
    },
    setItem: async (name, value) => {
      try {
        if (bridge) await bridge.save(value);
        else localStorage.setItem(scoped(name), value);
        report(null);
      } catch {
        report('工作区设置保存失败，本次调整可能无法在重启后保留');
      }
    },
    removeItem: async (name) => {
      try {
        if (bridge) await bridge.clear();
        else localStorage.removeItem(scoped(name));
        report(null);
      } catch {
        report('工作区设置清除失败，请重试');
      }
    },
  };
}
