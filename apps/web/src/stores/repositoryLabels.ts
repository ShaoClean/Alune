import type { Repository } from '@alune/shared';
import { repositoryGroupId } from './repositorySource';

export function worktreeKindLabel(kind: Repository['worktreeKind']): string | undefined {
  return kind === 'linked' ? '关联工作区' : kind === 'main' ? '主工作区' : undefined;
}

const normalizedPath = (path: string) => {
  const windows = /^(?:\/?[a-z]:[\\/]|\\\\|\/\/)/i.test(path);
  return (windows ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '') || '/';
};

// Compute against the full registry, never the filtered tree or just the open tabs.
// Remove the repeated repository directory before resolving collisions: shortening
// already-unique suffixes afterwards can make two different paths identical again.
export function repositoryWorkspaceLabels(repositories: Repository[]): Map<string, string> {
  const entries = repositories.map((repo) => {
    const path = normalizedPath(repo.path);
    return { repo, path, parts: path.split('/'), group: repositoryGroupId(repo) };
  });
  for (const entry of entries) {
    if (entry.parts.length <= 1 || entry.parts.at(-1) !== entry.repo.name) continue;
    const parent = entry.parts.slice(0, -1);
    const parentPath = parent.join('/') || '/';
    // A separately registered parent directory can have the same display name.
    // Keep the child directory in that case so the two identities stay distinct.
    if (
      !entries.some(
        (other) =>
          other.group === entry.group &&
          other.repo.name === entry.repo.name &&
          other.path === parentPath,
      )
    )
      entry.parts = parent;
  }
  return new Map(
    entries.map((entry) => {
      const peers = entries.filter(
        (other) =>
          other.group === entry.group &&
          other.repo.name === entry.repo.name &&
          other.path !== entry.path,
      );
      if (!peers.length && entry.repo.worktreeKind !== 'linked') return [entry.repo.id, ''];
      let length = 1;
      const suffix = () => entry.parts.slice(-length).join('/') || '/';
      while (
        length < entry.parts.length &&
        peers.some((other) => (other.parts.slice(-length).join('/') || '/') === suffix())
      )
        length++;
      return [entry.repo.id, suffix()];
    }),
  );
}

export function repositoryAccessibleName(repo: Repository, source: string): string {
  return [repo.name, worktreeKindLabel(repo.worktreeKind), source, repo.path]
    .filter(Boolean)
    .join(' · ');
}

// Use the shortest unique path suffix within each host, independent of filtering
// and branch names. Preserve POSIX backslashes and support Windows registrations.
export function repositoryPathLabels(repositories: Repository[]): Map<string, string> {
  const entries = repositories.map((repo) => {
    const path = normalizedPath(repo.path);
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
