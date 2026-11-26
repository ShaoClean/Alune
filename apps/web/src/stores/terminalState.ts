import { create } from 'zustand';
import type { TerminalSession } from '@alune/domain';

export type ViewSession = TerminalSession & {
  number?: number;
  name?: string;
  title?: string;
  truncated?: boolean;
  inputError?: string;
};
export type SplitAxis = 'columns' | 'rows';
export type TerminalSplit = { axis: SplitAxis; ids: [string, string]; percent: number };

export const terminalName = (session: ViewSession) =>
  session.name || session.title || (session.source === 'ssh' ? 'SSH' : session.repositoryName);
export const tabNumber = (session: ViewSession) => String(session.number ?? 1).padStart(2, '0');

type TerminalStore = {
  sessions: ViewSession[];
  selected: Record<string, string>;
  splits: Record<string, TerminalSplit | undefined>;
  visible: boolean;
  allOpen: boolean;
  maximized: boolean;
  height: number;
  connected: boolean;
  error: string;
  toggle: () => void;
  select: (session: TerminalSession) => void;
  setSplit: (repo: string, split?: TerminalSplit) => void;
  rename: (id: string, name: string) => void;
  move: (id: string, repoIndex: number) => void;
  remove: (id: string) => void;
};

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  selected: {},
  splits: {},
  visible: false,
  allOpen: false,
  maximized: false,
  height: 340,
  connected: false,
  error: '',
  toggle: () => set((state) => ({ visible: !state.visible })),
  select: ({ id, repositoryId: repo }) =>
    set((state) => {
      const split = state.splits[repo];
      let splits = state.splits;
      if (split && !split.ids.includes(id)) {
        const ids: [string, string] = [...split.ids];
        ids[split.ids[1] === state.selected[repo] ? 1 : 0] = id;
        splits = { ...splits, [repo]: { ...split, ids } };
      }
      return { visible: true, selected: { ...state.selected, [repo]: id }, splits };
    }),
  setSplit: (repo, split) => set((state) => ({ splits: { ...state.splits, [repo]: split } })),
  rename: (id, name) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, name: name.trim().slice(0, 48) } : s,
      ),
    })),
  move: (id, repoIndex) =>
    set((state) => {
      const from = state.sessions.findIndex((s) => s.id === id);
      if (from < 0) return state;
      const sessions = [...state.sessions];
      const target = sessions.filter((s) => s.repositoryId === sessions[from].repositoryId)[
        repoIndex
      ];
      if (!target || target.id === id) return state;
      const to = sessions.indexOf(target);
      sessions.splice(to, 0, ...sessions.splice(from, 1));
      return { sessions };
    }),
  remove: (id) =>
    set((state) => {
      const repo = state.sessions.find((s) => s.id === id)?.repositoryId;
      if (!repo) return state;
      const sessions = state.sessions.filter((s) => s.id !== id);
      const split = state.splits[repo];
      const selected = { ...state.selected };
      const splits = { ...state.splits };
      if (split?.ids.includes(id)) delete splits[repo];
      if (selected[repo] === id) {
        const next =
          split?.ids.find((other) => other !== id) ??
          sessions.filter((s) => s.repositoryId === repo).at(-1)?.id;
        if (next) selected[repo] = next;
        else delete selected[repo];
      }
      return { sessions, splits, selected };
    }),
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
