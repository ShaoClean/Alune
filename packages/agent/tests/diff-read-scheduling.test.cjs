const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitReads } = require('../dist/modules/git/git-commands');
const { CommandOutputLimitError } = require('../dist/ports/process');
const result = (stdout, exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const indexRow = (file) => '100644 ' + 'a'.repeat(40) + ' 0\t' + file + '\0';
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('worktree diff overlaps index validation and drains both reads before returning a validation error', async () => {
  for (const invalidIndex of [false, true]) {
    let finishIndex, finishDiff;
    const calls = [];
    const reads = new GitReads({
      execGit(_root, args) {
        calls.push(args);
        return new Promise((resolve) => {
          if (args[0] === 'ls-files') finishIndex = resolve;
          else finishDiff = resolve;
        });
      },
    });
    let done = false;
    const pending = reads.diff('/fixture', { file: 'tracked.txt' }).finally(() => {
      done = true;
    });
    const checked = invalidIndex
      ? assert.rejects(pending, /单个文件/)
      : assert.doesNotReject(async () => assert.equal(await pending, 'verified patch'));
    assert.equal(calls.length, 2, 'the second read must start without waiting for the first');
    finishIndex(result(indexRow(invalidIndex ? 'tracked.txt/child' : 'tracked.txt')));
    await tick();
    assert.equal(done, false, 'a rejected index must not leave a live speculative Git read');
    finishDiff(result('verified patch'));
    await checked;
  }
});

test('speculative diff failures retain preview limits and Git errors after successful index validation', async () => {
  for (const failure of [new CommandOutputLimitError(), result('', 128, 'fixture Git error')]) {
    const reads = new GitReads({
      execGit(_root, args) {
        if (args[0] === 'ls-files') return Promise.resolve(result(indexRow('tracked.txt')));
        return failure instanceof Error ? Promise.reject(failure) : Promise.resolve(failure);
      },
    });
    await assert.rejects(
      reads.diff('/fixture', { file: 'tracked.txt' }),
      failure instanceof Error ? /1 MiB/ : /fixture Git error/,
    );
  }
});

test('untracked previews still check file state and permissions then use no-index', async () => {
  const calls = [];
  class Reads extends GitReads {
    async _checkPreviewFile(_root, file) {
      calls.push(['preview-permissions', file]);
    }
  }
  const reads = new Reads({
    async execGit(_root, args) {
      calls.push(args);
      if (args[0] === 'ls-files') return result(args.includes('--others') ? 'new.txt\0' : '');
      return args.includes('--no-index') ? result('new file patch', 1) : result('');
    },
  });
  assert.equal(await reads.diff('/fixture', { file: 'new.txt' }), 'new file patch');
  assert(
    calls.findIndex((c) => c[0] === 'preview-permissions') <
      calls.findIndex((c) => c.includes('--no-index')),
  );
});

test('staged previews check blob size before starting the diff', async () => {
  const calls = [];
  const reads = new GitReads({
    async execGit(_root, args) {
      calls.push(args);
      if (args[0] === 'ls-files') return result(indexRow('tracked.txt'));
      if (args[0] === 'cat-file') return result(String(1024 * 1024 + 1));
      assert.fail('an oversized staged blob must not start a diff');
    },
  });
  await assert.rejects(reads.diff('/fixture', { file: 'tracked.txt', staged: true }), /1 MiB/);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['ls-files', 'cat-file'],
  );
});
