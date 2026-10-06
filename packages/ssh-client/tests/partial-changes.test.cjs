const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRepository } = require('./helpers/local-repository.cjs');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const { PartialChanges, LocalConnection, SSHConnection } = require('../dist');
const { parsePatchHunks } = require('@alune/shared');
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

async function setup(t, kind = 'local') {
  const f = createRepository();
  t.after(f.close);
  let root = f.repo;
  let transport = new LocalConnection();
  if (kind === 'worktree') {
    root = path.join(f.root, 'linked worktree');
    f.git('worktree', 'add', '-qb', 'partial-test', root);
  }
  if (kind === 'ssh') {
    const server = await startSSHServer();
    transport = new SSHConnection(server.options);
    transport.on('error', () => {});
    await transport.connect();
    t.after(async () => {
      transport.disconnect();
      await server.close();
    });
  }
  const { execFileSync } = require('node:child_process');
  return {
    ...f,
    root,
    transport,
    changes: new PartialChanges(transport),
    write: (file, text) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    },
    read: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
    git: (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }),
  };
}
async function apply(f, file, action, select, extra = {}) {
  const preview = await f.changes.preview(f.root, file, action === 'unstage');
  assert.ok(preview.revision, preview.unavailableReason);
  const selection = typeof select === 'function' ? select(parsePatchHunks(preview.diff)) : select;
  return f.changes.apply(f.root, {
    file,
    action,
    revision: preview.revision,
    selection,
    ...(action === 'discard' ? { confirmed: true } : {}),
    ...extra,
  });
}
const all = (hunks) => ({ hunks: hunks.map((h) => h.index) });
const kindRows = (kind) => (hunks) => ({
  lines: hunks.flatMap((h) => h.rows.filter((r) => r.kind === kind).map((r) => r.index)),
});

for (const kind of ['local', 'worktree', 'ssh']) {
  test(
    `${kind}: hunk stage / unstage / discard preserve other hunks and both diff sides`,
    { skip: kind === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const f = await setup(t, kind);
      const file = "目录/中文 '$HOME' [*].txt";
      const original = Array.from({ length: 32 }, (_, i) => `line ${i}\n`).join('');
      f.write(file, original);
      f.git('add', '.');
      f.git('commit', '-qm', 'seed');
      const changed = original
        .replace('line 2\n', 'first edit\n')
        .replace('line 27\n', 'last edit\n');
      f.write(file, changed);
      await apply(f, file, 'stage', { hunks: [0] });
      assert.equal(f.git('show', `:${file}`), original.replace('line 2\n', 'first edit\n'));
      assert.match(f.git('diff', '--', file), /last edit/);
      assert.doesNotMatch(f.git('diff', '--', file), /first edit/);
      await apply(f, file, 'unstage', all);
      assert.equal(f.git('show', `:${file}`), original);
      assert.equal(f.read(file), changed);
      await apply(f, file, 'discard', { hunks: [1] });
      assert.equal(f.read(file), original.replace('line 2\n', 'first edit\n'));
      assert.equal(f.git('show', `:${file}`), original);
    },
  );

  test(
    `${kind}: line selections, CRLF, no final newline and late external changes`,
    { skip: kind === 'ssh' && process.platform === 'win32' },
    async (t) => {
      const f = await setup(t, kind);
      const file = 'lines.txt';
      for (const ending of ['\n', '\r\n', '']) {
        const original = `top\r\nold${ending}`;
        const changed = `top\r\nnew${ending}`;
        f.write(file, original);
        f.git('add', '.');
        f.git('commit', '-qm', `seed ${JSON.stringify(ending)}`);
        f.write(file, changed);
        await apply(f, file, 'stage', kindRows('add'));
        const retained = original + (ending ? '' : '\n') + `new${ending}`;
        assert.equal(f.git('show', `:${file}`), retained);
        await apply(f, file, 'unstage', all);
        assert.equal(f.git('show', `:${file}`), original);
        await apply(f, file, 'stage', kindRows('remove'));
        assert.equal(f.git('show', `:${file}`), 'top\r\n');
        await apply(f, file, 'unstage', all);
        const preview = await f.changes.preview(f.root, file, false);
        f.write(file, changed + '\nexternal');
        await assert.rejects(
          f.changes.apply(f.root, {
            file,
            action: 'stage',
            revision: preview.revision,
            selection: { hunks: [0] },
          }),
          (e) => e.statusCode === 409,
        );
        assert.equal(f.git('show', `:${file}`), original);
        f.write(file, changed);
        await apply(f, file, 'discard', all);
        assert.equal(f.read(file), original);
      }
    },
  );
}

test('new indexed files, deleted files, staged renames and unborn HEAD', async (t) => {
  const f = await setup(t);
  f.write('new.txt', 'one\ntwo\n');
  f.git('add', 'new.txt');
  await apply(f, 'new.txt', 'unstage', (h) => ({
    lines: [h[0].rows.find((r) => r.content === 'two\n').index],
  }));
  assert.equal(f.git('show', ':new.txt'), 'one\n');
  await apply(f, 'new.txt', 'unstage', all);
  assert.equal(f.git('ls-files', '--', 'new.txt'), '');
  assert.equal(f.read('new.txt'), 'one\ntwo\n');
  f.write('delete.txt', 'one\ntwo\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'delete base');
  fs.unlinkSync(path.join(f.root, 'delete.txt'));
  await apply(f, 'delete.txt', 'stage', (h) => ({ lines: [h[0].rows[0].index] }));
  assert.equal(f.git('show', ':delete.txt'), 'two\n');
  await apply(f, 'delete.txt', 'stage', all);
  assert.equal(f.git('ls-files', '--', 'delete.txt'), '');
  await apply(f, 'delete.txt', 'unstage', all);
  await apply(f, 'delete.txt', 'discard', all);
  assert.equal(f.read('delete.txt'), 'one\ntwo\n');
  f.git('mv', 'delete.txt', 'renamed.txt');
  f.write('renamed.txt', 'one\nchanged\n');
  await apply(f, 'renamed.txt', 'stage', all);
  assert.equal(f.git('show', ':renamed.txt'), 'one\nchanged\n');
  await apply(f, 'renamed.txt', 'unstage', kindRows('add'));
  assert.equal(f.git('ls-files', '--', 'renamed.txt'), '');
  const unborn = createRepository({ initial: false });
  t.after(unborn.close);
  unborn.write('new.txt', 'one\ntwo\n');
  unborn.git('add', '.');
  const changes = new PartialChanges(new LocalConnection());
  const preview = await changes.preview(unborn.repo, 'new.txt', true);
  await changes.apply(unborn.repo, {
    file: 'new.txt',
    action: 'unstage',
    revision: preview.revision,
    selection: { hunks: [0] },
  });
  assert.equal(unborn.git('ls-files'), '');
});

test('attributes normalize CRLF for index operations and preserve worktree CRLF on discard', async (t) => {
  const f = await setup(t);
  f.write('.gitattributes', '*.txt text eol=crlf\n');
  f.write('crlf.txt', 'one\r\ntwo\r\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'crlf');
  f.write('crlf.txt', 'one\r\nnew\r\n');
  await apply(f, 'crlf.txt', 'stage', all);
  assert.equal(f.git('show', ':crlf.txt'), 'one\nnew\n');
  await apply(f, 'crlf.txt', 'unstage', all);
  await apply(f, 'crlf.txt', 'discard', all);
  assert.equal(f.read('crlf.txt'), 'one\r\ntwo\r\n');
});

test('rejects unsafe selection, missing confirmation, stale worktree/index/HEAD and late edits', async (t) => {
  const f = await setup(t);
  const file = 'tracked.txt';
  f.write(file, 'changed\n');
  const preview = await f.changes.preview(f.root, file, false);
  const request = {
    file,
    action: 'discard',
    revision: preview.revision,
    selection: { hunks: [0] },
  };
  await assert.rejects(f.changes.apply(f.root, request), /确认/);
  for (const selection of [
    { hunks: [] },
    { lines: [0] },
    { hunks: [99] },
    { lines: [-1] },
    { hunks: [0, 0] },
    { hunks: [0], lines: [4] },
  ])
    await assert.rejects(f.changes.apply(f.root, { ...request, action: 'stage', selection }));
  assert.equal(f.read(file), 'changed\n');
  assert.equal(f.git('show', ':tracked.txt'), 'original\n');
  f.git('add', file);
  await assert.rejects(
    f.changes.apply(f.root, { ...request, confirmed: true }),
    (e) => e.statusCode === 409,
  );
  const staged = await f.changes.preview(f.root, file, true);
  f.write(file, 'external\n');
  await assert.rejects(
    f.changes.apply(f.root, { ...request, action: 'unstage', revision: staged.revision }),
    (e) => e.statusCode === 409,
  );
  assert.equal(f.git('show', ':tracked.txt'), 'changed\n');
  const current = await f.changes.preview(f.root, file, false);
  const originalExec = f.transport.execGit.bind(f.transport);
  f.transport.execGit = async (root, args, signal, options) => {
    const result = await originalExec(root, args, signal, options);
    if (args.includes('--check')) f.write(file, 'late external\n');
    return result;
  };
  await assert.rejects(
    f.changes.apply(f.root, { ...request, revision: current.revision, confirmed: true }),
    (e) => e.statusCode === 409,
  );
  assert.equal(f.read(file), 'late external\n');
});

test('untracked, binary, symlink and large files have explicit limitations; large text remains usable', async (t) => {
  const f = await setup(t);
  f.write('untracked.txt', 'new\n');
  assert.match(
    (await f.changes.preview(f.root, 'untracked.txt', false)).unavailableReason,
    /未跟踪/,
  );
  f.write('binary.bin', Buffer.from([0, 1, 2]));
  f.git('add', '.');
  f.git('commit', '-qm', 'binary');
  f.write('binary.bin', Buffer.from([0, 2, 3]));
  assert.match((await f.changes.preview(f.root, 'binary.bin', false)).unavailableReason, /二进制/);
  f.write('large.txt', Array.from({ length: 15000 }, (_, i) => `中文 ${i} text\n`).join(''));
  f.git('add', 'large.txt');
  f.git('commit', '-qm', 'large');
  const edited = f.read('large.txt').replace('中文 100 text', '中文 100 changed');
  f.write('large.txt', edited);
  await apply(f, 'large.txt', 'stage', all);
  assert.equal(f.git('show', ':large.txt'), edited);
  if (process.platform !== 'win32') {
    fs.symlinkSync('tracked.txt', path.join(f.root, 'link'));
    f.git('add', 'link');
    f.git('commit', '-qm', 'link');
    fs.unlinkSync(path.join(f.root, 'link'));
    fs.symlinkSync('large.txt', path.join(f.root, 'link'));
    assert.match((await f.changes.preview(f.root, 'link', false)).unavailableReason, /符号链接/);
  }
});

test('custom filters and ident conversion keep the ordinary preview but disable partial writes', async (t) => {
  const f = await setup(t);
  f.write('text.txt', '$Id$\nold\n');
  f.git('add', '.');
  f.git('commit', '-qm', 'attributes');
  f.write('text.txt', '$Id$\nnew\n');
  for (const attribute of ['filter=custom', 'ident']) {
    f.write('.gitattributes', `text.txt ${attribute}\n`);
    const preview = await f.changes.preview(f.root, 'text.txt', false);
    assert.match(preview.unavailableReason, /过滤器|编码/);
    assert.equal(preview.revision, undefined);
    assert.match(preview.diff, /new/);
    assert.equal(f.git('show', ':text.txt'), '$Id$\nold\n');
  }
});
