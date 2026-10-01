import type { ReactNode } from 'react';
import { createStore } from 'zustand/vanilla';

export interface FeedbackEvent {
  id: string;
  host?: string;
  content?: ReactNode;
  actions?: ReactNode;
  scope: string;
  context: string;
  revision: string;
  title: string;
  description?: string;
  type: 'error' | 'warning' | 'info' | 'success';
  /** Legacy intent controls configuration actions; all modes now enter the modal queue. */
  mode: 'modal' | 'notification' | 'manual';
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  busy?: boolean;
  /** Dialog icon names for the glyph and the action orb; default to the type's icons. */
  icon?: string;
  actionIcon?: string;
}
export interface FeedbackEntry extends FeedbackEvent {
  lease: number;
  queued: boolean;
  /** When this revision first arrived. */
  at: number;
}

// One current result per source. Acknowledgement survives remounting a view;
// callbacks only live while their source is mounted in the active scope.
export function createFeedbackStore() {
  let lease = 0;
  const seen = new Map<string, string>();
  return createStore<{
    entries: FeedbackEntry[];
    updatePresentation: (id: string, content?: ReactNode, actions?: ReactNode) => void;
    publish: (event: FeedbackEvent) => number;
    release: (id: string, lease: number) => void;
    acknowledge: (id: string) => void;
    rearm: (id: string) => void;
    run: (id: string) => Promise<void>;
  }>((set, get) => ({
    entries: [],
    updatePresentation(id, content, actions) {
      const current = get().entries.find((entry) => entry.id === id);
      if (!current || (current.content === content && current.actions === actions)) return;
      set({
        entries: get().entries.map((entry) =>
          entry === current ? { ...entry, content, actions } : entry,
        ),
      });
    },
    publish(event) {
      const previous = get().entries.find((entry) => entry.id === event.id);
      const fresh = seen.get(event.id) !== event.revision;
      seen.delete(event.id);
      seen.set(event.id, event.revision);
      if (seen.size > 200) seen.delete(seen.keys().next().value!);
      const entry = {
        ...event,
        lease: ++lease,
        busy: event.busy ?? (fresh ? false : previous?.busy),
        at: fresh || !previous ? Date.now() : previous.at,
        queued: fresh || previous?.queued || false,
      };
      set({
        entries:
          previous && !fresh
            ? get().entries.map((item) => (item.id === event.id ? entry : item))
            : [...get().entries.filter((item) => item.id !== event.id), entry],
      });
      return entry.lease;
    },
    release(id, owner) {
      set({ entries: get().entries.filter((entry) => entry.id !== id || entry.lease !== owner) });
    },
    acknowledge(id) {
      set({
        entries: get().entries.map((entry) =>
          entry.id === id ? { ...entry, queued: false } : entry,
        ),
      });
    },
    rearm(id) {
      seen.delete(id);
    },
    async run(id) {
      const entry = get().entries.find((item) => item.id === id);
      if (!entry?.onAction || entry.busy) return;
      get().rearm(id);
      set({
        entries: get().entries.map((item) => (item === entry ? { ...item, busy: true } : item)),
      });
      try {
        await entry.onAction();
      } catch (error) {
        // A late rejection must never recreate a notice after navigation.
        if (get().entries.some((item) => item.id === id && item.lease === entry.lease))
          get().publish({
            ...entry,
            mode: 'modal',
            type: 'error',
            title: '操作未完成',
            description: error instanceof Error ? error.message : String(error),
            revision: `${entry.revision}:retry:${entry.lease}`,
            busy: false,
          });
      } finally {
        set({
          entries: get().entries.map((item) =>
            item.id === id && item.lease === entry.lease ? { ...item, busy: false } : item,
          ),
        });
      }
    },
  }));
}

export type FeedbackStore = ReturnType<typeof createFeedbackStore>;
