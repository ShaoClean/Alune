import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { canMoveTreeItem, moveBeforeOrAfter, orderedIds } from './sidebarOrder';
import type { Placement, TreeItem } from './sidebarOrder';
import { createWorkspaceStorage } from './workspaceStorage';
import { DEFAULT_LAYOUT, readLayoutPreferences } from './workspaceLayout';
import type { LayoutPreferences } from './workspaceLayout';

type RepositoryIdentity = { id: string; connectionId: string };
type Preferences = {
  layout: LayoutPreferences;
  treeOpen: boolean;
  collapsedConnectionIds: string[];
  connectionOrder: string[];
  repositoryOrderByConnection: Record<string, string[]>;
};
interface WorkspaceState extends Preferences {
  updateLayout: (patch: Partial<LayoutPreferences>) => void;
  resetLayout: () => void;
  validatedConnectionIds: string[] | null;
  reconcileRepositories: (repositories: RepositoryIdentity[]) => void;
  reconcileConnections: (ids: string[]) => void;
  addConnection: (id: string) => void;
  removeConnection: (id: string) => void;
  addRepository: (repo: RepositoryIdentity) => void;
  removeRepository: (id: string) => void;
  setConnectionCollapsed: (id: string, collapsed: boolean) => void;
  moveTreeItem: (source: TreeItem, target: TreeItem, placement: Placement) => boolean;
  setTreeOpen: (value: boolean) => void;
}

const defaults: Preferences = {
  layout: DEFAULT_LAYOUT,
  treeOpen: true,
  collapsedConnectionIds: [],
  connectionOrder: [],
  repositoryOrderByConnection: {},
};

const stringIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string'))]
    : [];
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Browser storage is untrusted and may belong to an older app version.
function readPreferences(value: unknown): Preferences {
  const saved = record(value);
  return {
    layout: readLayoutPreferences(saved.layout),
    treeOpen: typeof saved.treeOpen === 'boolean' ? saved.treeOpen : true,
    collapsedConnectionIds: stringIds(saved.collapsedConnectionIds),
    connectionOrder: stringIds(saved.connectionOrder),
    repositoryOrderByConnection: Object.fromEntries(
      Object.entries(record(saved.repositoryOrderByConnection))
        .filter(([, ids]) => Array.isArray(ids))
        .map(([id, ids]) => [id, stringIds(ids)]),
    ),
  };
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...defaults,
      updateLayout: (patch) =>
        set((state) => ({ layout: readLayoutPreferences({ ...state.layout, ...patch }) })),
      resetLayout: () => set({ layout: { ...DEFAULT_LAYOUT } }),
      validatedConnectionIds: null,
      // Call only after a successful, unfiltered response from the backend.
      reconcileRepositories: (repositories) =>
        set((state) => {
          const groups = new Map<string, string[]>();
          for (const repo of repositories) {
            if (
              state.validatedConnectionIds &&
              !state.validatedConnectionIds.includes(repo.connectionId)
            )
              continue;
            const ids = groups.get(repo.connectionId) || [];
            ids.push(repo.id);
            groups.set(repo.connectionId, ids);
          }
          return {
            repositoryOrderByConnection: Object.fromEntries(
              [...groups].map(([id, ids]) => [
                id,
                orderedIds(ids, state.repositoryOrderByConnection[id]),
              ]),
            ),
          };
        }),
      reconcileConnections: (ids) =>
        set((state) => ({
          validatedConnectionIds: ids,
          connectionOrder: orderedIds(ids, state.connectionOrder),
          collapsedConnectionIds: state.collapsedConnectionIds.filter((id) => ids.includes(id)),
          repositoryOrderByConnection: Object.fromEntries(
            Object.entries(state.repositoryOrderByConnection).filter(([id]) => ids.includes(id)),
          ),
        })),
      addConnection: (id) =>
        set((state) => ({
          connectionOrder: orderedIds([...state.connectionOrder, id]),
          validatedConnectionIds: state.validatedConnectionIds
            ? orderedIds([...state.validatedConnectionIds, id])
            : null,
        })),
      removeConnection: (id) =>
        set((state) => ({
          connectionOrder: state.connectionOrder.filter((savedId) => savedId !== id),
          validatedConnectionIds:
            state.validatedConnectionIds?.filter((savedId) => savedId !== id) ?? null,
          collapsedConnectionIds: state.collapsedConnectionIds.filter((savedId) => savedId !== id),
          repositoryOrderByConnection: Object.fromEntries(
            Object.entries(state.repositoryOrderByConnection).filter(([savedId]) => savedId !== id),
          ),
        })),
      addRepository: (repo) =>
        set((state) => ({
          repositoryOrderByConnection: {
            ...state.repositoryOrderByConnection,
            [repo.connectionId]: orderedIds([
              ...(state.repositoryOrderByConnection[repo.connectionId] || []),
              repo.id,
            ]),
          },
        })),
      removeRepository: (id) =>
        set((state) => ({
          repositoryOrderByConnection: Object.fromEntries(
            Object.entries(state.repositoryOrderByConnection).map(([connectionId, ids]) => [
              connectionId,
              ids.filter((savedId) => savedId !== id),
            ]),
          ),
        })),
      setConnectionCollapsed: (id, collapsed) =>
        set((state) => ({
          collapsedConnectionIds: collapsed
            ? stringIds([...state.collapsedConnectionIds, id])
            : state.collapsedConnectionIds.filter((savedId) => savedId !== id),
        })),
      moveTreeItem: (source, target, placement) => {
        if (!canMoveTreeItem(source, target)) return false;
        const state = get();
        const ids =
          source.kind === 'connection'
            ? state.connectionOrder
            : state.repositoryOrderByConnection[source.connectionId] || [];
        const next = moveBeforeOrAfter(ids, source.id, target.id, placement);
        if (next.every((id, index) => id === ids[index])) return false;
        if (source.kind === 'connection') set({ connectionOrder: next });
        else
          set({
            repositoryOrderByConnection: {
              ...state.repositoryOrderByConnection,
              [source.connectionId]: next,
            },
          });
        return true;
      },
      setTreeOpen: (treeOpen) => set({ treeOpen }),
    }),
    {
      name: 'remote-git-workspace',
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => createWorkspaceStorage()),
      partialize: ({
        treeOpen,
        collapsedConnectionIds,
        connectionOrder,
        repositoryOrderByConnection,
        layout,
      }) => ({
        treeOpen,
        collapsedConnectionIds,
        connectionOrder,
        repositoryOrderByConnection,
        layout,
      }),
      merge: (saved, current) => ({ ...current, ...readPreferences(saved) }),
    },
  ),
);

let hydration: Promise<void> | undefined;
export function hydrateWorkspace(): Promise<void> {
  hydration ??= Promise.resolve(useWorkspaceStore.persist.rehydrate());
  return hydration;
}
