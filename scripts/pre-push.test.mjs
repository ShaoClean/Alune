import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = fileURLToPath(new URL('../', import.meta.url));

function success(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture(t, { install = true, lockVersion = '0.1.1', lockRootVersion = '0.1.1' } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'remote-git-pre-push-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'checkout');
  const remote = path.join(directory, 'remote.git');
  mkdirSync(root);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config'),
    GIT_TERMINAL_PROMPT: '0',
  };
  const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, env, encoding: 'utf8', ...options });
  const git = (...args) => success(run('git', args));
  const installHooks = () => run(process.execPath, ['scripts/install-hooks.mjs']);
  const writeVersions = (version, lock = version, lockRoot = version) => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'hook-fixture', version, scripts: { commitlint: 'commitlint --config commitlint.config.cjs' } }));
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: lock, lockfileVersion: 3, packages: { '': { version: lockRoot } } }));
  };
  const commitVersions = (version) => {
    writeVersions(version);
    git('add', 'package.json', 'package-lock.json');
    git('commit', '-m', `chore(release): version ${version}`);
  };

  git('init', '--initial-branch=main');
  git('init', '--bare', remote);
  git('config', 'user.name', 'Hook test');
  git('config', 'user.email', 'hook-test@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  git('remote', 'add', 'origin', remote);
  for (const file of ['.githooks/pre-push', '.githooks/commit-msg', 'commitlint.config.cjs', 'scripts/install-hooks.mjs', 'scripts/pre-push.mjs', 'scripts/release-version.mjs']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(source, file), path.join(root, file));
  }
  symlinkSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeVersions('0.1.1', lockVersion, lockRootVersion);
  git('add', 'package.json', 'package-lock.json');
  git('commit', '-m', 'Initial versions');
  if (install) success(installHooks());

  const lintEvent = (name, event) => {
    const eventPath = path.join(directory, 'event.json');
    writeFileSync(eventPath, JSON.stringify(event));
    return run(process.execPath, [path.join(source, 'scripts/lint-commits.mjs')], {
      env: { ...env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: eventPath },
    });
  };
  return { root, remote, run, git, writeVersions, commitVersions, installHooks, lintEvent };
}

function blocked(result, message) {
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[pre-push\] Blocked/);
  assert.match(result.stderr, message);
}

test('installed hook allows a consistent branch and matching lightweight release tag', (t) => {
  const { git, installHooks } = fixture(t);
  success(installHooks()); // Installing twice must leave the hook enabled.
  assert.equal(git('config', '--local', '--get', 'core.hooksPath'), '.githooks');
  git('tag', 'v0.1.1');
  git('push', 'origin', 'main', 'v0.1.1');
});

test('an annotated tag is checked against its commit despite a newer HEAD and dirty files', (t) => {
  const { git, writeVersions, commitVersions } = fixture(t);
  git('tag', '-a', 'v0.1.1', '-m', 'Release 0.1.1');
  commitVersions('0.1.2');
  writeVersions('9.9.9');
  git('push', 'origin', 'v0.1.1');
});

test('the failed v0.1.2 release stays blocked even after fixing HEAD and the working tree', (t) => {
  const { git, run, remote, commitVersions } = fixture(t);
  git('tag', 'v0.1.2');
  commitVersions('0.1.2');
  blocked(run('git', ['push', 'origin', 'v0.1.2']), /v0\.1\.2 must equal package\.json version v0\.1\.1/);
  assert.notEqual(run('git', ['--git-dir', remote, 'show-ref', '--verify', 'refs/tags/v0.1.2']).status, 0);
});

test('branch pushes reject either out-of-sync root version in the committed lockfile', async (t) => {
  for (const field of ['lockVersion', 'lockRootVersion']) {
    await t.test(field, (t) => {
      const { run, writeVersions } = fixture(t, { [field]: '0.1.0' });
      writeVersions('0.1.1'); // An uncommitted fix must not hide the invalid commit.
      blocked(run('git', ['push', 'origin', 'main']), /package-lock\.json version is out of sync/);
    });
  }
});

test('release validation uses the destination tag name in explicit refspecs', (t) => {
  const { run, git } = fixture(t);
  blocked(run('git', ['push', 'origin', 'HEAD:refs/tags/v0.1.2']), /Release tag v0\.1\.2/);
  git('push', 'origin', 'HEAD:refs/tags/v0.1.1');
});

test('one invalid release tag blocks all refs in the same push', (t) => {
  const { git, run, remote } = fixture(t);
  git('tag', 'v0.1.2');
  blocked(run('git', ['push', 'origin', 'main', 'v0.1.2']), /refs\/tags\/v0\.1\.2/);
  assert.equal(git('--git-dir', remote, 'for-each-ref', '--format=%(refname)'), '');
});

test('release tags must be stable SemVer without leading zeroes', (t) => {
  const { git, run, commitVersions } = fixture(t);
  for (const version of ['0.1.1-beta.1', '00.1.1', '0.1']) {
    commitVersions(version);
    git('tag', `v${version}`);
    blocked(run('git', ['push', 'origin', `v${version}`]), /stable SemVer/);
  }
});

test('deleting an invalid remote release tag remains possible', (t) => {
  const { git, run, remote } = fixture(t);
  git('tag', 'v0.1.2');
  // Seed the historical mistake before exercising deletion with the hook enabled.
  git('-c', 'core.hooksPath=', 'push', 'origin', 'v0.1.2');
  git('push', 'origin', '--delete', 'v0.1.2');
  assert.notEqual(run('git', ['--git-dir', remote, 'show-ref', '--verify', 'refs/tags/v0.1.2']).status, 0);
});

test('non-release tags can still point to non-commit objects', (t) => {
  const { git } = fixture(t);
  git('tag', 'snapshot', git('rev-parse', 'HEAD:package.json'));
  git('push', 'origin', 'snapshot');
});

test('malformed or missing committed version files block release pushes', async (t) => {
  for (const failure of ['malformed', 'missing']) {
    await t.test(failure, (t) => {
      const { root, git, run } = fixture(t);
      if (failure === 'malformed') writeFileSync(path.join(root, 'package-lock.json'), '{');
      else rmSync(path.join(root, 'package-lock.json'));
      git('add', 'package-lock.json');
      git('commit', '-m', 'test: create invalid lockfile fixture');
      git('tag', 'v0.1.1');
      blocked(run('git', ['push', 'origin', 'v0.1.1']), /Cannot read valid package-lock\.json/);
    });
  }
});

test('installation preserves an existing custom hooks path', (t) => {
  const { git, installHooks } = fixture(t, { install: false });
  git('config', '--local', 'core.hooksPath', 'custom-hooks');
  const result = installHooks();
  success(result);
  assert.match(result.stderr, /Keeping existing core\.hooksPath/);
  assert.equal(git('config', '--get', 'core.hooksPath'), 'custom-hooks');
});

test('installation preserves existing hooks in the default directory', (t) => {
  const { root, run, installHooks } = fixture(t, { install: false });
  const hook = path.join(root, '.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n');
  const result = installHooks();
  success(result);
  assert.match(result.stderr, /Keeping existing Git hooks/);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n');
  assert.equal(run('git', ['config', '--get', 'core.hooksPath']).status, 1);
});

test('installed commit-msg hook accepts scoped Chinese messages and breaking changes', (t) => {
  const { git } = fixture(t);
  for (const message of [
    'feat(workspace): 记住侧边栏设置',
    'fix(ssh): 修复 SSH 断线后的重连',
    'perf: 加快仓库列表加载',
    'chore(release): 发布 0.2.0',
    'refactor(config)!: 调整配置格式\n\nBREAKING CHANGE: 旧配置需要重新导入。',
  ]) git('commit', '--allow-empty', '-m', message);
});

test('installed commit-msg hook rejects malformed messages without creating commits', (t) => {
  const { git, run } = fixture(t);
  const before = git('rev-parse', 'HEAD');
  for (const message of ['修改代码', 'feature: add a feature', 'fix:', 'Fix: wrong case', `feat: ${'x'.repeat(100)}`]) {
    const result = run('git', ['commit', '--allow-empty', '-m', message]);
    assert.notEqual(result.status, 0, message);
    assert.match(result.stdout + result.stderr, /type-enum|type-empty|subject-empty|type-case|header-max-length/);
    assert.equal(git('rev-parse', 'HEAD'), before);
  }
});

test('CI rejects invalid commits even when the local hook was bypassed', (t) => {
  const { git, lintEvent } = fixture(t);
  const before = git('rev-parse', 'HEAD');
  git('-c', 'core.hooksPath=', 'commit', '--allow-empty', '-m', 'unstructured change');
  const result = lintEvent('push', { before, after: git('rev-parse', 'HEAD') });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /type-empty/);
});

test('CI checks PR titles and commits while leaving pre-existing history alone', (t) => {
  const { git, lintEvent } = fixture(t);
  const base = { sha: git('rev-parse', 'HEAD') }; // Intentionally unstructured historical commit.
  git('commit', '--allow-empty', '-m', 'feat: 支持新功能');
  const head = { sha: git('rev-parse', 'HEAD') };
  const invalid = lintEvent('pull_request', { pull_request: { base, head, title: 'new feature' } });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /type-empty/);
  success(lintEvent('pull_request', { pull_request: { base, head, title: 'feat: 支持新功能' } }));
});

test('a new branch push checks changes since its merge base with the default branch', (t) => {
  const { git, lintEvent } = fixture(t);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-c', 'feature');
  git('commit', '--allow-empty', '-m', 'fix: 修复新分支上的问题');
  success(lintEvent('push', {
    before: '0'.repeat(40), after: git('rev-parse', 'HEAD'), ref: 'refs/heads/feature', repository: { default_branch: 'main' },
  }));
});

test('the initial default-branch push also checks its root commit', (t) => {
  const { git, lintEvent } = fixture(t);
  const event = () => ({
    before: '0'.repeat(40), after: git('rev-parse', 'HEAD'), ref: 'refs/heads/main', repository: { default_branch: 'main' },
  });
  const invalid = lintEvent('push', event());
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /type-empty/);
  git('commit', '--amend', '-m', 'chore: initialize versions');
  success(lintEvent('push', event()));
});
