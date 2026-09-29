import type { FileStatus } from './types/repository';

// Available UI actions. The backend separately validates the actual targets.
// Older status responses with a trailing slash remain non-actionable until
// they have been classified.
export function changeActions(file: FileStatus) {
  const directory = !!file.kind || file.path.endsWith('/');
  const submodule = file.kind === 'submodule';
  return {
    diff: !directory || submodule,
    stage:
      !file.staged &&
      (!directory ||
        (submodule &&
          (file.conflicted || file.submodule?.commitChanged || file.status === 'deleted'))),
    unstage: file.staged,
    discard:
      !file.staged &&
      !directory &&
      !file.conflicted &&
      !['untracked', 'added'].includes(file.status),
    delete: !directory && ['untracked', 'added'].includes(file.status),
    open: !!file.repositoryPath,
    ignore: file.status === 'untracked' && directory && !submodule && !/[\r\n]/.test(file.path),
  };
}

export const changeKindLabel = (file: FileStatus): string =>
  file.kind === 'worktree'
    ? 'Worktree'
    : file.kind === 'repository'
      ? '嵌套仓库'
      : file.kind === 'submodule'
        ? '子模块'
        : file.kind === 'directory' || file.path.endsWith('/')
          ? '目录'
          : '';
