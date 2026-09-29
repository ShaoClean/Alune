import { createStore } from 'zustand/vanilla';

export interface FeedbackEvent {
  id: string;
  scope: string;
  context: string;
  revision: string;
  title: string;
  description?: string;
  type: 'error' | 'warning' | 'info' | 'success';
  mode: 'modal' | 'notification' | 'manual';
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  busy?: boolean;
}
export interface FeedbackEntry extends FeedbackEvent {
  lease: number;
  queued: boolean;
}

// One current result per source. Acknowledgement survives remounting a view;
// callbacks only live while their source is mounted in the active scope.
export function createFeedbackStore() {
  let lease = 0;
  const seen = new Map<string, string>();
  const retries = new Set<string>();
  return createStore<{
    entries: FeedbackEntry[];
    publish: (event: FeedbackEvent) => number;
    release: (id: string, lease: number) => void;
    acknowledge: (id: string) => void;
    rearm: (id: string) => void;
    settle: (id: string) => void;
    run: (id: string) => Promise<void>;
  }>((set, get) => ({
    entries: [],
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
        queued: fresh
          ? event.mode === 'modal' || (retries.has(event.id) && !event.busy)
          : previous?.queued || false,
      };
      if (!event.busy) retries.delete(event.id);
      set({
        entries: previous
          ? get().entries.map((item) => (item.id === event.id ? entry : item))
          : [...get().entries, entry],
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
    settle(id) {
      retries.delete(id);
    },
    async run(id) {
      const entry = get().entries.find((item) => item.id === id);
      if (!entry?.onAction || entry.busy) return;
      retries.add(id);
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
