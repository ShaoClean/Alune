import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  repositoryPathLabels,
  repositoryWorkspaceLabels,
  repositoryAccessibleName,
  worktreeKindLabel,
} from '../src/stores/repositoryLabels.ts';

const repo = (id, path, extra = {}) => ({ id, path, name: 'alune', source: 'local', ...extra });

test('same-name directories get unique suffixes without inferring worktree identity', () => {
  const entries = [
    repo('main', '/projects/alune', { worktreeKind: 'main' }),
    repo('feature', '/features/alune', { worktreeKind: 'linked' }),
    repo('detached', '/reviews/alune', { worktreeKind: 'linked', currentBranch: '' }),
    repo('ordinary', '/unrelated/alune'),
  ];
  assert.deepEqual(
    [...repositoryPathLabels(entries).values()],
    ['projects/alune', 'features/alune', 'reviews/alune', 'unrelated/alune'],
  );
  assert.equal(worktreeKindLabel(entries[0].worktreeKind), '主工作区');
  assert.equal(worktreeKindLabel(entries[2].worktreeKind), '关联工作区');
  assert.equal(worktreeKindLabel(entries[3].worktreeKind), undefined);
});

test('suffixes expand through repeated parents and stay scoped to their host', () => {
  const entries = [
    repo('a', '/one/feature/alune'),
    repo('b', '/two/feature/alune'),
    repo('ssh', '/one/feature/alune', { source: 'ssh', connectionId: 'a' }),
    repo('alias', '/one/feature/alune/'),
    repo('root', '/'),
  ];
  assert.deepEqual(
    [...repositoryPathLabels(entries).values()],
    ['one/feature/alune', 'two/feature/alune', 'alune', 'one/feature/alune', '/'],
  );
});

test('Windows and literal POSIX paths remain distinguishable', () => {
  assert.deepEqual(
    [
      ...repositoryPathLabels([
        repo('a', 'C:\\one\\alune'),
        repo('b', 'D:\\one\\alune'),
        repo('c', '/repo/literal\\name'),
        repo('d', '/repo/空 格\n目录'),
        repo('e', '/alune'),
        repo('f', '/other/alune'),
      ]).values(),
    ],
    ['C:/one/alune', 'D:/one/alune', 'literal\\name', '空 格\n目录', '/alune', 'other/alune'],
  );
});

test('compact workspace identities distinguish the main checkout and multiple worktrees', () => {
  const entries = [
    repo('main', '/Users/me/Desktop/alune', { worktreeKind: 'main' }),
    repo('diff', '/worktrees/issue-136-diff-theme/alune', { worktreeKind: 'linked' }),
    repo('history', '/worktrees/issue-142-history/alune', { worktreeKind: 'linked' }),
    repo('other', '/projects/docs', { name: 'docs' }),
  ];
  const labels = repositoryWorkspaceLabels(entries);
  assert.deepEqual(
    [...labels.values()],
    ['Desktop', 'issue-136-diff-theme', 'issue-142-history', ''],
  );
  // Branch changes and tab order must not change the identity used by either surface.
  const reordered = repositoryWorkspaceLabels(
    entries.toReversed().map((r) => ({ ...r, currentBranch: 'main' })),
  );
  for (const entry of entries) assert.equal(reordered.get(entry.id), labels.get(entry.id));
  assert.equal(repositoryWorkspaceLabels([entries[1]]).get('diff'), 'issue-136-diff-theme');
});

test('removing repeated directory names does not reintroduce collisions', () => {
  const labels = repositoryWorkspaceLabels([
    repo('a', '/one/feature/alune'),
    repo('b', '/two/feature/alune'),
    repo('renamed', '/three/feature'),
    repo('root', '/alune'),
  ]);
  assert.deepEqual([...labels.values()], ['one/feature', 'two/feature', 'three/feature', '/']);
  assert.equal(new Set(labels.values()).size, 4);
});

test('compact labels respect Windows drives, POSIX backslashes and host boundaries', () => {
  assert.deepEqual(
    [
      ...repositoryWorkspaceLabels([
        repo('a', 'C:\\one\\alune'),
        repo('b', 'D:\\one\\alune'),
        repo('literal', '/repo/literal\\name'),
        repo('remote', '/one/alune', { source: 'ssh', connectionId: 'dev' }),
        repo('remote-wt', '/two/alune', {
          source: 'ssh',
          connectionId: 'dev',
          worktreeKind: 'linked',
        }),
        repo('remote-other', '/one/alune', { source: 'ssh', connectionId: 'other' }),
      ]).values(),
    ],
    ['C:/one', 'D:/one', 'literal\\name', 'one', 'two', ''],
  );
});

test('nested registrations remain distinct when the parent shares the repository name', () => {
  const entries = [
    repo('parent', '/projects/feature'),
    repo('child', '/projects/feature/alune'),
    repo('grandchild', '/projects/feature/alune/alune'),
  ];
  assert.deepEqual(
    [...repositoryWorkspaceLabels(entries).values()],
    ['feature', 'feature/alune', 'alune/alune'],
  );
  const roots = repositoryWorkspaceLabels([repo('root', '/'), repo('child', '/alune')]);
  assert.deepEqual([...roots.values()], ['/', 'alune']);
});

test('accessible identities include the type, host and original path without guessing unknown kinds', () => {
  assert.equal(
    repositoryAccessibleName(repo('a', '/feature/alune', { worktreeKind: 'linked' }), '开发服务器'),
    'alune · 关联工作区 · 开发服务器 · /feature/alune',
  );
  assert.equal(
    repositoryAccessibleName(repo('b', '/repo/alune'), '本机'),
    'alune · 本机 · /repo/alune',
  );
});
