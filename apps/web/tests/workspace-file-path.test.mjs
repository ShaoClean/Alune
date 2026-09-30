import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteWorkspacePath } from '../src/components/WorkspaceFileMenu.tsx';

test('absolute clipboard paths use the current local/worktree/SSH root and preserve literal filenames', () => {
  const name = "子目录/中文 空格 $ [*] '文件.txt";
  for (const root of ['/home/user/repo', '/worktrees/feature', '/remote/repo'])
    assert.equal(absoluteWorkspacePath(root, name), `${root}/${name}`);
  assert.equal(absoluteWorkspacePath('/', name), `/${name}`);
  assert.equal(absoluteWorkspacePath('C:/repo/', name), `C:/repo/${name}`);
  assert.equal(
    absoluteWorkspacePath('C:\\repo\\', name),
    `C:\\repo\\${name.replaceAll('/', '\\')}`,
  );
  assert.equal(absoluteWorkspacePath('\\\\server\\share', 'a/b'), '\\\\server\\share\\a\\b');
  assert.equal(absoluteWorkspacePath('//server/share', 'a/b'), '//server/share/a/b');
  assert.equal(
    absoluteWorkspacePath('/remote/repo', 'literal\\backslash'),
    '/remote/repo/literal\\backslash',
  );
});
