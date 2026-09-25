import type { RepositoryTreeEntry, RepositoryTreeListing } from '@alune/shared';

// State of one lazily loaded directory. A reload keeps the previous listing so the
// tree does not jump while it refreshes or after a failed retry.
export type DirectoryState =
  | { phase: 'loading'; listing?: RepositoryTreeListing }
  | { phase: 'ready'; listing: RepositoryTreeListing }
  | { phase: 'error'; message: string; status?: number; listing?: RepositoryTreeListing };

export type TreeRow =
  | {
      type: 'entry';
      entry: RepositoryTreeEntry;
      level: number;
      position: number;
      setSize: number;
      parent: string;
      expanded?: boolean;
    }
  | {
      type: 'notice';
      directory: string;
      level: number;
      notice: 'loading' | 'error' | 'empty' | 'truncated';
    };

export const ROOT = '';

export const parentOf = (path: string) => {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? ROOT : path.slice(0, slash);
};

export const isExpandable = (entry: RepositoryTreeEntry) => entry.kind === 'directory';

// Flattens the expanded part of the tree into rows. Directories without state yet
// are reported so the view can load them; nothing below a collapsed folder is read.
export function treeRows(
  directories: Readonly<Record<string, DirectoryState | undefined>>,
  expanded: ReadonlySet<string>,
): { rows: TreeRow[]; pending: string[] } {
  const rows: TreeRow[] = [];
  const pending: string[] = [];
  const visit = (path: string, level: number) => {
    const state = directories[path];
    if (!state) {
      pending.push(path);
      if (path !== ROOT) rows.push({ type: 'notice', directory: path, level, notice: 'loading' });
      return;
    }
    // The root's own loading and error states are shown in place of the tree.
    if (path !== ROOT && state.phase !== 'ready' && (state.phase === 'error' || !state.listing))
      rows.push({ type: 'notice', directory: path, level, notice: state.phase });
    const listing = state.listing;
    if (!listing) return;
    if (path !== ROOT && listing.entries.length === 0)
      rows.push({ type: 'notice', directory: path, level, notice: 'empty' });
    listing.entries.forEach((entry, index) => {
      const open = isExpandable(entry) && expanded.has(entry.path);
      rows.push({
        type: 'entry',
        entry,
        level,
        position: index + 1,
        setSize: listing.entries.length,
        parent: path,
        expanded: isExpandable(entry) ? open : undefined,
      });
      if (open) visit(entry.path, level + 1);
    });
    if (listing.truncated)
      rows.push({ type: 'notice', directory: path, level, notice: 'truncated' });
  };
  visit(ROOT, 1);
  return { rows, pending };
}

// Directories whose listing is currently on screen, for a refresh that should not
// touch folders hidden under a collapsed parent.
export function visibleDirectories(
  directories: Readonly<Record<string, DirectoryState | undefined>>,
  expanded: ReadonlySet<string>,
): string[] {
  const result = [ROOT];
  const { rows } = treeRows(directories, expanded);
  for (const row of rows) if (row.type === 'entry' && row.expanded) result.push(row.entry.path);
  return result;
}

export const errorStatus = (error: any): number | undefined => error?.response?.status;

export const errorMessage = (error: any, fallback: string): string =>
  error?.response?.data?.message || error?.message || fallback;
