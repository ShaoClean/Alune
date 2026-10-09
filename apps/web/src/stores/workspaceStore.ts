import { LOCAL_GROUP_ID, repositoryGroupId } from './repositorySource';
import { DEFAULT_APPEARANCE, readAppearancePreferences } from './appearance';
import type { AppearancePreferences } from './appearance';
import {
  DEFAULT_CODE_APPEARANCE,
  readCodeAppearance,
  readCodeFontFamily,
  readCodeFontSize,
} from './codeAppearance';
import type { CodeAppearancePreferences } from './codeAppearance';
import {
  BUILTIN_CODE_THEMES,
  DEFAULT_CODE_THEME_IDS,
  MAX_CUSTOM_THEMES,
  importCodeTheme,
} from '../code-themes';
import type { CodeThemeMode } from '../code-themes';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { canMoveTreeItem, moveBeforeOrAfter, orderedIds } from './sidebarOrder';
import type { Placement, TreeItem } from './sidebarOrder';
import { createWorkspaceStorage } from './workspaceStorage';
import { DEFAULT_LAYOUT, readLayoutPreferences } from './workspaceLayout';
import type { LayoutPreferences } from './workspaceLayout';
import { readRepositorySession, removeSessionRepositories } from './repositorySession';
import type { RepositorySession } from './repositorySession';

type RepositoryIdentity = { id: string; connectionId?: string; source?: 'local' | 'ssh' };
export type CollectionView = 'grid' | 'list' | 'overview';
export type CollectionPage = 'repositories' | 'connections';
type Preferences = {
  repositorySession: RepositorySession;
  collectionViews: Record<CollectionPage, CollectionView>;
  appearance: AppearancePreferences;
  codeAppearance: CodeAppearancePreferences;
  layout: LayoutPreferences;
  collapsedConnectionIds: string[];
  connectionOrder: string[];
  repositoryOrderByConnection: Record<string, string[]>;
};
interface WorkspaceState extends Preferences {
  activateRepositoryTab: (id: string) => void;
  moveRepositoryTab: (sourceId: string, targetId: string, placement: Placement) => void;
  closeRepositoryTabs: (ids: string[], preferredId?: string) => void;
  codeAppearanceNotice: string | null;
  dismissCodeAppearanceNotice: () => void;
  selectCodeTheme: (mode: CodeThemeMode, id: string) => boolean;
  importCodeTheme: (
    text: string,
    filename: string,
  ) => { name: string; mode: CodeThemeMode; ignoredRules: number };
  removeCodeTheme: (id: string) => void;
  updateCodeFont: (
    patch: Partial<Pick<CodeAppearancePreferences, 'fontFamily' | 'fontSize'>>,
  ) => void;
  resetCodeAppearance: () => void;
  setCollectionView: (page: CollectionPage, view: CollectionView) => void;
  updateAppearance: (patch: Partial<AppearancePreferences>) => void;
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
}

const defaults: Preferences = {
  repositorySession: { ids: [], activeId: null },
  collectionViews: { repositories: 'grid', connections: 'grid' },
  appearance: DEFAULT_APPEARANCE,
  codeAppearance: DEFAULT_CODE_APPEARANCE,
  layout: DEFAULT_LAYOUT,
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
function readPreferences(value: unknown): Preferences & { codeAppearanceNotice: string | null } {
  const saved = record(value);
  const views = record(saved.collectionViews);
  const code = readCodeAppearance(saved.codeAppearance);
  return {
    repositorySession: readRepositorySession(saved.repositorySession),
    collectionViews: {
      repositories:
        views.repositories === 'overview'
          ? 'overview'
          : views.repositories === 'list'
            ? 'list'
            : 'grid',
      connections: views.connections === 'list' ? 'list' : 'grid',
    },
    appearance: readAppearancePreferences(saved.appearance),
    codeAppearance: code.preferences,
    codeAppearanceNotice: code.notice,
    layout: readLayoutPreferences(saved.layout),
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
      activateRepositoryTab: (id) => {
        const session = get().repositorySession;
        if (session.activeId === id && session.ids.includes(id)) return;
        set({
          repositorySession: {
            ids: session.ids.includes(id) ? session.ids : [...session.ids, id],
            activeId: id,
          },
        });
      },
      moveRepositoryTab: (sourceId, targetId, placement) =>
        set((state) => ({
          repositorySession: {
            ...state.repositorySession,
            ids: moveBeforeOrAfter(state.repositorySession.ids, sourceId, targetId, placement),
          },
        })),
      closeRepositoryTabs: (ids, preferredId) =>
        set((state) => ({
          repositorySession: removeSessionRepositories(state.repositorySession, ids, preferredId),
        })),
      codeAppearanceNotice: null,
      dismissCodeAppearanceNotice: () => set({ codeAppearanceNotice: null }),
      selectCodeTheme: (mode, id) => {
        const preferences = get().codeAppearance;
        if (
          ![...BUILTIN_CODE_THEMES, ...preferences.customThemes].some(
            (theme) => theme.id === id && theme.mode === mode,
          )
        )
          return false;
        set({
          codeAppearance: { ...preferences, [mode === 'light' ? 'lightTheme' : 'darkTheme']: id },
          codeAppearanceNotice: null,
        });
        return true;
      },
      importCodeTheme: (text, filename) => {
        const preferences = get().codeAppearance;
        if (preferences.customThemes.length >= MAX_CUSTOM_THEMES)
          throw new Error(`最多安装 ${MAX_CUSTOM_THEMES} 个自定义主题，请先卸载不再使用的主题。`);
        const { theme, ignoredRules } = importCodeTheme(
          text,
          filename,
          `custom-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
        );
        set({
          codeAppearance: { ...preferences, customThemes: [...preferences.customThemes, theme] },
        });
        return { name: theme.name, mode: theme.mode, ignoredRules };
      },
      removeCodeTheme: (id) => {
        const preferences = get().codeAppearance;
        if (!preferences.customThemes.some((theme) => theme.id === id)) return;
        const selected = preferences.lightTheme === id || preferences.darkTheme === id;
        set({
          codeAppearance: {
            ...preferences,
            lightTheme:
              preferences.lightTheme === id ? DEFAULT_CODE_THEME_IDS.light : preferences.lightTheme,
            darkTheme:
              preferences.darkTheme === id ? DEFAULT_CODE_THEME_IDS.dark : preferences.darkTheme,
            customThemes: preferences.customThemes.filter((theme) => theme.id !== id),
          },
          codeAppearanceNotice: selected
            ? '所选代码主题已卸载，已恢复对应外观的 Catppuccin 默认主题。'
            : get().codeAppearanceNotice,
        });
      },
      updateCodeFont: (patch) =>
        set((state) => ({
          codeAppearance: {
            ...state.codeAppearance,
            ...(patch.fontFamily !== undefined
              ? { fontFamily: readCodeFontFamily(patch.fontFamily) }
              : {}),
            ...(patch.fontSize !== undefined ? { fontSize: readCodeFontSize(patch.fontSize) } : {}),
          },
        })),
      resetCodeAppearance: () =>
        set((state) => ({
          codeAppearance: {
            ...DEFAULT_CODE_APPEARANCE,
            customThemes: state.codeAppearance.customThemes,
          },
          codeAppearanceNotice: null,
        })),
      setCollectionView: (page, view) =>
        set((state) => ({
          collectionViews: {
            ...state.collectionViews,
            [page]: page === 'connections' && view === 'overview' ? 'grid' : view,
          },
        })),
      updateAppearance: (patch) =>
        set((state) => ({
          appearance: readAppearancePreferences({ ...state.appearance, ...patch }),
        })),
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
              repo.source !== 'local' &&
              !state.validatedConnectionIds.includes(repositoryGroupId(repo))
            )
              continue;
            const ids = groups.get(repositoryGroupId(repo)) || [];
            ids.push(repo.id);
            groups.set(repositoryGroupId(repo), ids);
          }
          return {
            repositorySession: removeSessionRepositories(
              state.repositorySession,
              state.repositorySession.ids.filter(
                (id) => !repositories.some((repo) => repo.id === id),
              ),
            ),
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
          connectionOrder: orderedIds(
            [...(state.connectionOrder.includes(LOCAL_GROUP_ID) ? [LOCAL_GROUP_ID] : []), ...ids],
            state.connectionOrder,
          ),
          collapsedConnectionIds: state.collapsedConnectionIds.filter(
            (id) => id === LOCAL_GROUP_ID || ids.includes(id),
          ),
          repositoryOrderByConnection: Object.fromEntries(
            Object.entries(state.repositoryOrderByConnection).filter(
              ([id]) => id === LOCAL_GROUP_ID || ids.includes(id),
            ),
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
          ...(repo.source === 'local'
            ? { connectionOrder: orderedIds([...state.connectionOrder, LOCAL_GROUP_ID]) }
            : {}),
          repositoryOrderByConnection: {
            ...state.repositoryOrderByConnection,
            [repositoryGroupId(repo)]: orderedIds([
              ...(state.repositoryOrderByConnection[repositoryGroupId(repo)] || []),
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
    }),
    {
      name: 'alune-workspace',
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => createWorkspaceStorage()),
      partialize: ({
        repositorySession,
        collapsedConnectionIds,
        connectionOrder,
        repositoryOrderByConnection,
        layout,
        appearance,
        codeAppearance,
        collectionViews,
      }) => ({
        repositorySession,
        collapsedConnectionIds,
        connectionOrder,
        repositoryOrderByConnection,
        layout,
        appearance,
        codeAppearance,
        collectionViews,
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
