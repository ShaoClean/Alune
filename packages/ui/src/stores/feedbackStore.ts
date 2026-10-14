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
  /** Intent controls configuration actions; automatic presentation defaults to the modal queue. */
  mode: 'modal' | 'notification' | 'manual';
  /** Inbox-only notices do not interrupt the current view. */
  autoOpen?: boolean;
  /**
   * `state` mirrors an ongoing condition and leaves with its source; `event` is a
   * one-off operation result that stays in the inbox until the user clears it.
   */
  kind?: 'state' | 'event';
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

/** One-off results kept in the inbox; older ones fall off first. */
export const EVENT_LIMIT = 50;

export const readKey = (entry: Pick<FeedbackEvent, 'id' | 'revision'>) =>
  `${entry.id}:${entry.revision}`;

// One current result per source. Acknowledgement survives remounting a view;
// callbacks only live while their source is mounted in the active scope.
export function createFeedbackStore() {
  let lease = 0;
  const seen = new Map<string, string>();
  return createStore<{
    entries: FeedbackEntry[];
    /** Revisions the user has seen; a new revision of the same source is unread again. */
    read: ReadonlySet<string>;
    markRead: (ids?: string[]) => void;
    dismiss: (id: string) => void;
    clearRead: () => void;
    updatePresentation: (id: string, content?: ReactNode, actions?: ReactNode) => void;
    publish: (event: FeedbackEvent) => number;
    release: (id: string, lease: number) => void;
    acknowledge: (id: string) => void;
    rearm: (id: string) => void;
    run: (id: string) => Promise<void>;
  }>((set, get) => ({
    entries: [],
    read: new Set(),
    markRead(ids) {
      const fresh = get()
        .entries.filter((entry) => !entry.host && (!ids || ids.includes(entry.id)))
        .map(readKey)
        .filter((key) => !get().read.has(key));
      if (!fresh.length) return;
      const read = new Set([...get().read, ...fresh]);
      // Remounted sources stay read; only the oldest keys are forgotten.
      for (const key of read) {
        if (read.size <= 500) break;
        read.delete(key);
      }
      set({ read });
    },
    dismiss(id) {
      set({ entries: get().entries.filter((entry) => entry.id !== id || entry.kind !== 'event') });
    },
    clearRead() {
      const { read } = get();
      set({
        entries: get().entries.filter(
          (entry) => entry.kind !== 'event' || entry.host || !read.has(readKey(entry)),
        ),
      });
    },
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
        queued: event.autoOpen !== false && (fresh || previous?.queued || false),
      };
      let entries =
        previous && !fresh
          ? get().entries.map((item) => (item.id === event.id ? entry : item))
          : [...get().entries.filter((item) => item.id !== event.id), entry];
      const events = entries.filter((item) => item.kind === 'event' && !item.host);
      if (events.length > EVENT_LIMIT) {
        const dropped = new Set(events.slice(0, events.length - EVENT_LIMIT));
        entries = entries.filter((item) => !dropped.has(item));
      }
      set({ entries });
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
            autoOpen: true,
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
