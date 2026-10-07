import type { FileStatus, RepositoryTreeEntry } from '@alune/shared';
import { parentOf } from './files-tree';

export type FileDecorationStatus = FileStatus['status'] | 'conflicted';

export const FILE_DECORATIONS = {
  added: { badge: 'A', label: '新增' },
  untracked: { badge: 'U', label: '未跟踪' },
  modified: { badge: 'M', label: '已修改' },
  deleted: { badge: 'D', label: '已删除' },
  renamed: { badge: 'R', label: '已重命名' },
  copied: { badge: 'C', label: '已复制' },
  conflicted: { badge: '!', label: '存在冲突' },
  ignored: { badge: '', label: '已忽略' },
} satisfies Record<FileDecorationStatus, { badge: string; label: string }>;

// Merge index/worktree records independently of their order. A staged addition
// stays green after further edits; conflicts and deletions take precedence.
const priority: Record<FileDecorationStatus, number> = {
  conflicted: 7,
  deleted: 6,
  added: 5,
  renamed: 4,
  copied: 3,
  modified: 2,
  untracked: 1,
  ignored: 0,
};

export function fileStatusIndex(files: readonly FileStatus[] = []) {
  const direct = new Map<string, FileDecorationStatus>();
  const descendants = new Map<string, FileDecorationStatus>();
  const put = (
    map: Map<string, FileDecorationStatus>,
    path: string,
    status: FileDecorationStatus,
  ) => {
    const previous = map.get(path);
    if (!previous || priority[status] > priority[previous]) map.set(path, status);
  };
  for (const file of files) {
    const status = file.conflicted ? 'conflicted' : file.status;
    // Git paths already use '/'. Backslashes and whitespace are literal names.
    const path = file.path.replace(/\/$/, '');
    put(direct, path, status);
    // An ignored child does not make its parent directory ignored.
    if (status === 'ignored') continue;
    for (let parent = parentOf(path); parent; parent = parentOf(parent))
      put(descendants, parent, status);
  }
  return { direct, descendants };
}

export function fileDecoration(
  index: ReturnType<typeof fileStatusIndex>,
  entry: RepositoryTreeEntry,
) {
  const direct = index.direct.get(entry.path);
  const status =
    direct ??
    (entry.kind === 'directory' ? index.descendants.get(entry.path) : undefined) ??
    (entry.ignored ? 'ignored' : undefined);
  if (!status) return undefined;
  const summary = !direct && status !== 'ignored' && entry.kind === 'directory';
  return {
    status,
    badge: summary ? '•' : FILE_DECORATIONS[status].badge,
    label: summary ? `包含${FILE_DECORATIONS[status].label}的文件` : FILE_DECORATIONS[status].label,
    summary,
  };
}

// Polls with identical status must not repeatedly read directories or previews.
export function filesStatusRevision(files: readonly FileStatus[] = []) {
  return JSON.stringify(
    files
      .map(({ path, oldPath, status, staged, conflicted }) =>
        JSON.stringify([path, oldPath, status, staged, Boolean(conflicted)]),
      )
      .sort(),
  );
}
