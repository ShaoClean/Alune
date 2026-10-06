import type {
  ConflictKind,
  ConflictSide,
  FileStatus,
  RepositoryOperationState,
} from '@alune/shared';

export const conflictKindLabels: Record<ConflictKind, string> = {
  'both-modified': '双方修改',
  'both-added': '双方新增',
  'both-deleted': '双方删除',
  'added-by-us': '当前新增',
  'added-by-them': '传入新增',
  'deleted-by-us': '当前删除',
  'deleted-by-them': '传入删除',
};

const conflictHints: Record<ConflictKind, string> = {
  'both-modified': '双方都修改了此文件。逐块选择要保留的内容后标记为已解决，或整体采用一方。',
  'both-added': '双方都新增了同名文件。逐块选择要保留的内容后标记为已解决，或整体采用一方。',
  'both-deleted': '双方都删除了此路径，通常是双方把它重命名到了不同位置。确认删除后即可继续。',
  'added-by-us': '只有当前一方有此路径，通常来自重命名冲突。请确认保留还是删除。',
  'added-by-them': '只有传入的一方有此路径，通常来自重命名冲突。请确认保留还是删除。',
  'deleted-by-us': '当前一方删除了此文件，传入的一方修改了它。请选择保留传入的版本或删除。',
  'deleted-by-them': '当前一方修改了此文件，传入的一方删除了它。请选择保留当前版本或删除。',
};

export const conflictHint = (kind?: ConflictKind) =>
  kind ? conflictHints[kind] : '此文件有未解决的冲突。处理内容后标记为已解决。';

// Content conflicts have markers to resolve per block; the others only have whole-file choices.
export const hasConflictBlocks = (kind?: ConflictKind) =>
  !kind || kind === 'both-modified' || kind === 'both-added';

export interface WholeFileAction {
  side: ConflictSide;
  label: string;
  // Deletes the path from the worktree and index.
  removes?: boolean;
}

export function wholeFileActions(kind?: ConflictKind): WholeFileAction[] {
  switch (kind) {
    case 'deleted-by-them':
      return [
        { side: 'current', label: '保留当前版本' },
        { side: 'incoming', label: '删除文件', removes: true },
      ];
    case 'deleted-by-us':
      return [
        { side: 'incoming', label: '保留传入版本' },
        { side: 'current', label: '删除文件', removes: true },
      ];
    case 'added-by-us':
      return [
        { side: 'current', label: '保留文件' },
        { side: 'incoming', label: '删除文件', removes: true },
      ];
    case 'added-by-them':
      return [
        { side: 'incoming', label: '保留文件' },
        { side: 'current', label: '删除文件', removes: true },
      ];
    case 'both-deleted':
      return [{ side: 'current', label: '确认删除', removes: true }];
    default:
      return [
        { side: 'current', label: '采用当前' },
        { side: 'incoming', label: '采用传入' },
      ];
  }
}

export const operationNames: Record<RepositoryOperationState['kind'], string> = {
  merge: '合并',
  rebase: '变基',
  'cherry-pick': '拣选',
  revert: '还原',
};

export const shortHash = (hash?: string) => hash?.slice(0, 7) || '';

export function operationTitle(operation: RepositoryOperationState) {
  const name = operationNames[operation.kind];
  const target =
    operation.kind === 'merge'
      ? operation.branch || shortHash(operation.commit)
      : operation.kind === 'rebase'
        ? operation.branch || ''
        : shortHash(operation.commit);
  return `正在${name}${target ? ` ${target}` : ''}`;
}

export const operationProgress = (operation: RepositoryOperationState) =>
  operation.step && operation.total ? `${operation.step}/${operation.total}` : '';

// What "current" and "incoming" mean for the operation in progress; stash apply has none.
export function sideNames(operation?: RepositoryOperationState) {
  const commit = shortHash(operation?.commit);
  switch (operation?.kind) {
    case 'merge':
      return {
        current: '当前分支 HEAD',
        incoming: operation.branch ? `传入分支 ${operation.branch}` : `传入提交 ${commit}`,
      };
    case 'rebase':
      return {
        current: operation.onto ? `变基目标 ${shortHash(operation.onto)}` : '变基目标',
        incoming: commit ? `正在重放 ${commit}` : '正在重放的提交',
      };
    case 'cherry-pick':
      return { current: '当前 HEAD', incoming: `拣选的提交 ${commit}` };
    case 'revert':
      return { current: '当前 HEAD', incoming: `撤销 ${commit} 的改动` };
    default:
      return { current: '当前 HEAD', incoming: '传入的改动' };
  }
}

export const conflictedFiles = (files: FileStatus[]) => files.filter((file) => file.conflicted);

export interface ContextExcerpt {
  head: string;
  hidden: number;
  tail: string;
}

// Unchanged text between conflict blocks: keep a few lines next to each block, fold the rest.
// `before`/`after` say whether a block precedes or follows this text.
export function contextExcerpt(
  text: string,
  { before, after }: { before: boolean; after: boolean },
  keep = 3,
): ContextExcerpt {
  const lines = text.split(/(?<=\n)/).filter(Boolean);
  const head = before ? keep : 0;
  const tail = after ? keep : 0;
  if (lines.length <= head + tail + 1) return { head: lines.join(''), hidden: 0, tail: '' };
  return {
    head: lines.slice(0, head).join(''),
    hidden: lines.length - head - tail,
    tail: tail ? lines.slice(-tail).join('') : '',
  };
}
