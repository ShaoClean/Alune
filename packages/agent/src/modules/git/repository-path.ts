import { posix } from 'node:path';
import { isWindowsPath } from './git-shell';

export function normalizeRepositoryPath(path: string): string {
  if (isWindowsPath(path)) path = path.replaceAll('\\', '/');
  const normalized = posix.normalize(path);
  return path.startsWith('//') && !path.startsWith('///') ? '/' + normalized : normalized;
}
export function joinRepositoryPath(root: string, ...parts: string[]): string {
  return normalizeRepositoryPath([root, ...parts].join('/'));
}

// Compare canonical filesystem answers using the target host's path syntax.
// POSIX backslashes and case remain significant.
export function sameRepositoryPath(left: string, right: string): boolean {
  if (isWindowsPath(left) && isWindowsPath(right))
    return normalizeRepositoryPath(left).toLowerCase() === normalizeRepositoryPath(right).toLowerCase();
  return left === right;
}
