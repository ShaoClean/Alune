const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { gitFileCommand } = require('../dist/git-shell');

test(
  'Windows PowerShell preserves Git stdout, stderr and exit status byte for byte',
  {
    skip: process.platform !== 'win32',
  },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "RemoteGit-shell-中文 ' "));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    execFileSync('git', ['-C', root, 'init', '-q']);
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, "nested/中文 空格 [特殊] $it's.txt"), 'fixture');
    const prefix = 'powershell -NoProfile -NonInteractive -EncodedCommand ';

    for (const [repo, args] of [
      [root, ['rev-parse', '--show-prefix']],
      [path.join(root, 'nested'), ['rev-parse', '--show-prefix']],
      [root, ['status', '--porcelain=v2', '-z', '--untracked-files=all']],
      [root, ['rev-parse', '--verify', 'refs/heads/nonexistent-fixture-branch']],
    ]) {
      const direct = spawnSync('git', ['--literal-pathspecs', '-C', repo, ...args]);
      const command = gitFileCommand(repo, args);
      assert.ok(command.startsWith(prefix));
      const wrapped = spawnSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        command.slice(prefix.length),
      ]);
      assert.ifError(direct.error);
      assert.ifError(wrapped.error);
      assert.equal(wrapped.status, direct.status, args.join(' '));
      assert.deepEqual(wrapped.stdout, direct.stdout, args.join(' '));
      assert.deepEqual(wrapped.stderr, direct.stderr, args.join(' '));
    }
  },
);
