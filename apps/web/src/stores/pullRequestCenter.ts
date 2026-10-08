import { create } from 'zustand';
import type {
  PullRequestCenterItem,
  PullRequestCenterPage,
  PullRequestCenterQuery,
  PullRequestSources,
} from '@alune/shared';
import { pullRequestCenterApi } from '../api';
import { errorMessage } from '../components/files-tree';

export const defaultCenterQuery: PullRequestCenterQuery = {
  view: 'all',
  state: 'open',
  search: '',
  projects: [],
  provider: '',
  account: '',
};
export function readCenterQuery(params: URLSearchParams): PullRequestCenterQuery {
  const view = params.get('view'),
    state = params.get('state'),
    provider = params.get('provider');
  return {
    view: view === 'created' || view === 'review' ? view : 'all',
    state:
      view === 'review'
        ? 'open'
        : state === 'all' || state === 'merged' || state === 'closed'
          ? state
          : 'open',
    provider: provider === 'github' || provider === 'gitlab' ? provider : '',
    search: (params.get('q') || '').slice(0, 500),
    projects: [...new Set(params.getAll('project'))].sort(),
    account: params.get('account') || '',
  };
}
export function centerParams(query: PullRequestCenterQuery) {
  const params = new URLSearchParams();
  if (query.view !== 'all') params.set('view', query.view);
  if (query.state !== 'open') params.set('state', query.state);
  if (query.provider) params.set('provider', query.provider);
  if (query.search) params.set('q', query.search);
  if (query.account) params.set('account', query.account);
  [...query.projects].sort().forEach((p) => params.append('project', p));
  return params;
}
export const centerQueryKey = (query: PullRequestCenterQuery) => centerParams(query).toString();
export const centerListUrl = (query: PullRequestCenterQuery) =>
  `/pull-requests${centerQueryKey(query) ? `?${centerQueryKey(query)}` : ''}`;

type Entry = {
  discovery?: PullRequestSources;
  page?: PullRequestCenterPage;
  items: PullRequestCenterItem[];
  loading: boolean;
  error: string;
  updatedAt: number;
  scroll: number;
};
const emptyEntry = (): Entry => ({ items: [], loading: false, error: '', updatedAt: 0, scroll: 0 });
let controller: AbortController | undefined;
let generation = 0;

export const usePullRequestCenter = create<{
  entries: Record<string, Entry>;
  revision: number;
  load: (query: PullRequestCenterQuery, mode?: 'refresh' | 'more') => Promise<void>;
  stop: () => void;
  invalidate: () => void;
  setScroll: (key: string, scroll: number) => void;
}>((set, get) => ({
  entries: {},
  revision: 0,
  setScroll: (key, scroll) =>
    set((s) => ({
      entries: { ...s.entries, [key]: { ...(s.entries[key] || emptyEntry()), scroll } },
    })),
  stop: () => {
    controller?.abort();
    generation++;
    set((s) => ({
      entries: Object.fromEntries(
        Object.entries(s.entries).map(([key, entry]) => [key, { ...entry, loading: false }]),
      ),
    }));
  },
  invalidate: () =>
    set((s) => ({
      revision: s.revision + 1,
      entries: Object.fromEntries(
        Object.entries(s.entries).map(([key, entry]) => [key, { ...entry, updatedAt: 0 }]),
      ),
    })),
  load: async (query, mode = 'refresh') => {
    get().stop();
    const current = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    const key = centerQueryKey(query);
    const previous = get().entries[key] || emptyEntry();
    const patch = (value: Partial<Entry>) => {
      if (generation !== current || signal.aborted) return;
      set((s) => {
        const entries = { ...s.entries, [key]: { ...(s.entries[key] || emptyEntry()), ...value } };
        // Cache only a few recent filter combinations, all in memory.
        const keys = Object.keys(entries);
        if (keys.length > 8) delete entries[keys.find((k) => k !== key)!];
        return { entries };
      });
    };
    patch({ loading: true, error: '' });
    try {
      let discovery = previous.discovery;
      let cursor = mode === 'more' ? previous.page?.nextCursor : undefined;
      if (mode === 'more' && !cursor) return;
      if (mode === 'refresh' || !discovery) {
        discovery = await pullRequestCenterApi.sources(undefined, signal);
        patch({ discovery });
        while (discovery.cursor) {
          discovery = await pullRequestCenterApi.sources(discovery.cursor, signal);
          patch({ discovery });
        }
      }
      let accumulated = mode === 'more' ? [...previous.items] : [];
      const initialCount = accumulated.length;
      let rounds = 0;
      do {
        const page = await pullRequestCenterApi.list(
          cursor ? { cursor } : { discoveryId: discovery!.discoveryId, query },
          signal,
        );
        const known = new Set(accumulated.map((item) => item.key));
        accumulated = [...accumulated, ...page.items.filter((item) => !known.has(item.key))];
        cursor = page.nextCursor;
        // A refresh keeps the previous list visible until the replacement has results
        // or scanning concludes. Cursors and rows are committed together when stopping.
        if (accumulated.length || !cursor || rounds >= 11)
          patch({ page, discovery, items: accumulated, updatedAt: Date.now() });
        else if (!previous.items.length) patch({ page, discovery });
        // Keep initial discovery moving, but bound sparse searches so users can stop
        // and explicitly continue scanning instead of silently downloading all history.
        if (++rounds >= 12 || accumulated.length - initialCount >= 30 || !cursor) break;
      } while (!signal.aborted);
    } catch (error) {
      if (!signal.aborted) patch({ error: errorMessage(error, '无法读取 PR/MR 中心，请重试。') });
    } finally {
      patch({ loading: false });
    }
  },
}));
