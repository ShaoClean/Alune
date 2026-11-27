import type { FileStatus } from '@alune/domain';

export type FileAction = 'stage' | 'unstage' | 'checkout';

export const changeActionPaths = (action: FileAction, files: FileStatus[]) => [
  ...new Set(
    files.flatMap((file) =>
      action !== 'checkout' && file.status === 'renamed' && file.oldPath
        ? [file.oldPath, file.path]
        : [file.path],
    ),
  ),
];
