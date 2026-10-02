import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repositoryPathLabels, worktreeKindLabel } from '../src/stores/repositoryLabels.ts';

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
