const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { GitLfs } = require('../dist');

const paths = Array.from(
  { length: 5358 },
  (_, i) => `目录 ${i}/中文 [*] '文件\n${'x'.repeat(32)}.bin`,
);
const result = (stdout = '', exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const attributes = (input, value = 'unspecified') =>
  Buffer.from(input)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => `${path}\0filter\0${value}\0`)
    .join('');
const transport = (files, check, signal) => ({
  signal,
  execGit: async (_repo, args, signal, options) => {
    if (args.includes('lfs')) return result('git-lfs/test');
    if (args[0] === 'ls-files') return result(files.join('\0') + (files.length ? '\0' : ''));
    assert.equal(args[0], 'check-attr');
    return check(options.stdin, signal);
  },
});

test('large Unicode path lists are checked completely with bounded bytes and concurrency', async () => {
  const checked = [];
  let active = 0;
  let peak = 0;
  let calls = 0;
  const connection = transport(paths, async (input) => {
    calls++;
    assert.ok(Buffer.byteLength(input) <= 4096);
    assert.equal(input[input.length - 1], 0);
    checked.push(...input.toString('utf8').split('\0').filter(Boolean));
    peak = Math.max(peak, ++active);
    await nextTurn();
    active--;
    return result(attributes(input));
  });
  assert.deepEqual(await new GitLfs(connection).status('/repo'), {
    installed: true,
    used: false,
    version: 'git-lfs/test',
  });
  assert.deepEqual(checked, paths);
  assert.ok(calls > 2);
  assert.equal(peak, 2);
});

test('finding LFS stops dispatching batches but waits for the in-flight sibling', async () => {
  let calls = 0;
  let siblingDone = false;
  const connection = transport(paths, async (input) => {
    const first = ++calls === 1;
    if (!first) {
      await nextTurn();
      siblingDone = true;
    }
    return result(attributes(input, first ? 'lfs' : 'unspecified'));
  });
  assert.equal((await new GitLfs(connection).status('/repo')).used, true);
  assert.equal(calls, 2);
  assert.equal(siblingDone, true);
});

for (const failure of ['command', 'deadline']) {
  test(`${failure} failure aborts in-flight work and stops remaining batches`, async () => {
    const controller = new AbortController();
    const error = new Error('scan deadline');
    let calls = 0;
    let cancelled = 0;
    const connection = transport(
      paths,
      async (_input, signal) => {
        if (++calls === 1) {
          await nextTurn();
          if (failure === 'command') return result('', 1, 'attribute read failed');
          controller.abort(error);
          signal.throwIfAborted();
        }
        return new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled++;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
      controller.signal,
    );
    await assert.rejects(
      new GitLfs(connection).status('/repo'),
      failure === 'command' ? /attribute read failed/ : /scan deadline/,
    );
    assert.equal(calls, 2);
    assert.equal(cancelled, 1);
  });
}

test('empty repositories skip attribute queries and oversized single paths fail explicitly', async () => {
  const unexpected = () => {
    throw new Error('must not query attributes');
  };
  assert.equal((await new GitLfs(transport([], unexpected)).status('/repo')).used, false);
  await assert.rejects(
    new GitLfs(transport(['中'.repeat(1400)], unexpected)).status('/repo'),
    /文件路径过长/,
  );
});
