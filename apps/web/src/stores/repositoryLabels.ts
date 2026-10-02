import type { Repository } from '@alune/shared';
import { repositoryGroupId } from './repositorySource';

export function worktreeKindLabel(kind: Repository['worktreeKind']): string | undefined {
  return kind === 'linked' ? '关联工作区' : kind === 'main' ? '主工作区' : undefined;
}

// Use the shortest unique path suffix within each host, independent of filtering
// and branch names. Preserve POSIX backslashes and support Windows registrations.
export function repositoryPathLabels(repositories: Repository[]): Map<string, string> {
  const entries = repositories.map((repo) => {
    const windows = /^(?:\/?[a-z]:[\\/]|\\\\|\/\/)/i.test(repo.path);
    const path = (windows ? repo.path.replace(/\\/g, '/') : repo.path).replace(/\/+$/, '') || '/';
    return { repo, path, parts: path.split('/'), group: repositoryGroupId(repo) };
  });
  return new Map(
    entries.map((entry) => {
      let length = 1;
      const suffix = () => entry.parts.slice(-length).join('/');
      while (
        length < entry.parts.length &&
        entries.some(
          (other) =>
            other !== entry &&
            other.group === entry.group &&
            other.path !== entry.path &&
            other.parts.slice(-length).join('/') === suffix(),
        )
      )
        length++;
      return [entry.repo.id, suffix() || entry.path];
    }),
  );
}
