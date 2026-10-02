import { create } from 'zustand';
import type { TerminalSession } from '@alune/shared';

export type ViewSession = TerminalSession & { truncated?: boolean; inputError?: string };
type TerminalStore = {
  sessions: ViewSession[];
  selected: Record<string, string>;
  visible: boolean;
  allOpen: boolean;
  maximized: boolean;
  height: number;
  connected: boolean;
  error: string;
  toggle: () => void;
  select: (session: TerminalSession) => void;
};
export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  selected: {},
  visible: false,
  allOpen: false,
  maximized: false,
  height: 340,
  connected: false,
  error: '',
  toggle: () => set((state) => ({ visible: !state.visible })),
  select: (session) =>
    set((state) => ({
      visible: true,
      selected: { ...state.selected, [session.repositoryId]: session.id },
    })),
}));

export const terminalStateLabel = (session: TerminalSession) =>
  ({
    connecting: '连接中',
    running: '运行中',
    failed: '启动失败',
    disconnected: '已断开',
    exited:
      session.exitCode === undefined
        ? `已退出 · ${session.signal || '信号'}`
        : `已退出 · ${session.exitCode}`,
  })[session.state];
