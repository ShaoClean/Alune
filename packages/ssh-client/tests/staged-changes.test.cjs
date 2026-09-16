const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { StagedChanges, AI_DIFF_MAX_BYTES } = require('../dist/staged-changes');
const { GitCommands } = require('../dist/git-commands');
const { gitFileCommand } = require('../dist/git-shell');

for (const initial of [true, false])
  test(`reads only staged data with ${initial ? 'existing' : 'unborn'} HEAD`, async (t) => {
    const f = createRepository({ initial });
    t.after(f.close);
    f.write('change.txt', 'STAGED_ONLY\n');
    f.git('add', 'change.txt');
    f.write('change.txt', 'UNSTAGED_SECRET\n');
    f.write('untracked.txt', 'NEVER_SEND\n');
    const before = f.git('ls-files', '--stage', '-z');
    const reader = new StagedChanges(f.connection, f.repo);
    const snapshot = await reader.read(new AbortController().signal);
    assert.match(snapshot.diff, /STAGED_ONLY/);
    assert.doesNotMatch(snapshot.diff, /UNSTAGED_SECRET|NEVER_SEND|untracked.txt/);
    assert.equal(f.git('ls-files', '--stage', '-z'), before);
    f.git('add', 'change.txt');
    await assert.rejects(
      reader.assertRevision(snapshot.revision, new AbortController().signal),
      /暂存内容已变化/,
    );
  });

test('binary metadata, empty index, excessive diff and cancellation have explicit behavior', async (t) => {
  const f = createRepository();
  t.after(f.close);
  const reader = new StagedChanges(f.connection, f.repo);
  await assert.rejects(reader.read(new AbortController().signal), /请先暂存/);
  f.write('asset.bin', Buffer.from([0, 1, 2, 3]));
  f.git('add', 'asset.bin');
  const binary = await reader.read(new AbortController().signal);
  assert.match(binary.diff, /Binary files/);
  assert.doesNotMatch(binary.diff, /GIT binary patch/);
  f.write('large.txt', 'x'.repeat(AI_DIFF_MAX_BYTES));
  f.git('add', 'large.txt');
  await assert.rejects(reader.read(new AbortController().signal), /96 KiB/);
  await assert.rejects(reader.read(AbortSignal.abort()), /abort/i);
});

test('changed index during snapshot capture is discarded', async (t) => {
  const f = createRepository();
  t.after(f.close);
  f.write('change.txt', 'before\n');
  f.git('add', 'change.txt');
  const connection = {
    execCommand: async (...args) => {
      const result = await f.connection.execCommand(...args);
      if (args[0].includes('--unified=3')) {
        f.write('change.txt', 'after\n');
        f.git('add', 'change.txt');
      }
      return result;
    },
  };
  await assert.rejects(
    new StagedChanges(connection, f.repo).read(new AbortController().signal),
    /已变化/,
  );
});

test('commits quotes, literal shell expressions and actual newlines without expansion', async (t) => {
  const f = createRepository();
  t.after(f.close);
  f.write('staged.txt', 'stage\n');
  f.git('add', 'staged.txt');
  f.write('unstaged.txt', 'keep\n');
  const message =
    'feat: 保留 "quote" 与 \'single\' $HOME $(touch sentinel) `touch sentinel`\n\n第一段\n\n第二段\\n字面反斜杠';
  const result = await new GitCommands(f.connection).commit(f.repo, message);
  assert.equal(result.exitCode, 0);
  assert.equal(f.git('log', '-1', '--format=format:%B'), message + '\n');
  assert.equal(fs.existsSync(path.join(f.repo, 'sentinel')), false);
  assert.equal(f.git('status', '--porcelain').includes('unstaged.txt'), true);
  const win = gitFileCommand('C:\\repo', ['commit', '--cleanup=verbatim', '-m', message]);
  assert.match(win, /^powershell -NoProfile -NonInteractive -EncodedCommand /);
  const script = Buffer.from(win.split(' ').at(-1), 'base64').toString('utf16le');
  assert.match(script, /ProcessStartInfo|StartInfo/);
  assert.match(script, /UseShellExecute = \$false/);
});
