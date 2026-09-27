import { posix } from 'node:path';

export function normalizeRepositoryPath(path: string): string {
  const normalized = posix.normalize(path);
  return path.startsWith('//') && !path.startsWith('///') ? '/' + normalized : normalized;
}
export function joinRepositoryPath(root: string, ...parts: string[]): string {
  return normalizeRepositoryPath([root, ...parts].join('/'));
}
