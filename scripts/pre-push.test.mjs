import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const run = (command, args) => spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  const git = (...args) => success(run('git', args));
  const installHooks = () => run(process.execPath, ['scripts/install-hooks.mjs']);
  const writeVersions = (version, lock = version, lockRoot = version) => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'hook-fixture', version }));
    writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: lock, lockfileVersion: 3, packages: { '': { version: lockRoot } } }));
  };
  const commitVersions = (version) => {
    writeVersions(version);
    git('add', 'package.json', 'package-lock.json');
    git('commit', '-m', `Version ${version}`);
  };

  git('init', '--initial-branch=main');
  git('init', '--bare', remote);
  git('config', 'user.name', 'Hook test');
  git('config', 'user.email', 'hook-test@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  git('remote', 'add', 'origin', remote);
  for (const file of ['.githooks/pre-push', 'scripts/install-hooks.mjs', 'scripts/pre-push.mjs', 'scripts/release-version.mjs']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(source, file), path.join(root, file));
  }
  writeVersions('0.1.1', lockVersion, lockRootVersion);
  git('add', 'package.json', 'package-lock.json');
  git('commit', '-m', 'Initial versions');
  if (install) success(installHooks());

  return { root, remote, run, git, writeVersions, commitVersions, installHooks };
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
      git('commit', '-m', 'Invalid lockfile');
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
