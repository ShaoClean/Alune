const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { fileAccessKernel } = require('../dist/modules/files/access');

test('explicit session grants preserve outside-repository text access and isolate authority', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alune-file-grants-'));
  const root = path.join(base, 'notes'),
    outside = path.join(base, 'private');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'note.txt'), 'original\n');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'private\n');
  const kernel = fileAccessKernel('agent-a');
  const context = (sessionId = 'session-a') => ({
    agentId: 'agent-a',
    sessionId,
    signal: new AbortController().signal,
    sessionSignal: new AbortController().signal,
  });
  const call = async (method, p = {}, c = context()) => {
    const h = kernel.handlers['files.' + method];
    h.validate(p);
    return h.run(p, c);
  };
  const denied = (fn) => assert.rejects(fn, (e) => e.kind === 'permission-denied');
  try {
    assert.deepEqual(await call('grants'), []);
    await denied(() =>
      call('read', { grant: { agentId: 'agent-a', id: 'unknown' }, path: 'note.txt' }),
    );
    await assert.rejects(
      () => call('grant', { path: root, access: 'read' }),
      (e) => e.kind === 'invalid-params',
    );
    const ro = await call('grant', { path: root, access: 'read', confirmed: true });
    assert.equal(ro.path, await fs.realpath(root));
    assert.equal(ro.lifetime, 'session');
    const grant = { id: ro.id, agentId: ro.agentId };
    assert.equal((await call('list', { grant, path: '' }))[0].name, 'note.txt');
    const read = await call('read', { grant, path: 'note.txt' });
    assert.equal(read.content, 'original\n');
    await fs.writeFile(path.join(root, 'bom.txt'), '\uFEFF中文\r\n');
    assert.equal((await call('read', { grant, path: 'bom.txt' })).content, '\uFEFF中文\r\n');
    await denied(() =>
      call('write', { grant, path: 'note.txt', content: 'denied', version: read.version }),
    );
    await denied(() => call('read', { grant, path: '../private/secret.txt' }));
    await denied(() => call('read', { grant, path: path.join(outside, 'secret.txt') }));
    await denied(() => call('read', { grant: { ...grant, agentId: 'agent-b' }, path: 'note.txt' }));
    await denied(() => call('read', { grant, path: 'note.txt' }, context('session-b')));
    assert.deepEqual(await call('grants', {}, context('session-b')), []);
    // A junction works on Windows without symlink privileges and represents the
    // same escape as a directory symlink on Unix.
    await fs.symlink(
      outside,
      path.join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await denied(() => call('read', { grant, path: 'escape/secret.txt' }));
    await denied(() => call('list', { grant, path: 'escape' }));
    const rw = await call('grant', { path: root, access: 'read-write', confirmed: true });
    const writeGrant = { id: rw.id, agentId: rw.agentId };
    await denied(() =>
      call('write', {
        grant: writeGrant,
        path: 'escape/secret.txt',
        content: 'denied',
        version: read.version,
      }),
    );
    await fs.writeFile(path.join(root, 'note.txt'), 'external\n');
    await assert.rejects(
      () =>
        call('write', {
          grant: writeGrant,
          path: 'note.txt',
          content: 'stale',
          version: read.version,
        }),
      (e) => e.kind === 'conflict',
    );
    const current = await call('read', { grant: writeGrant, path: 'note.txt' });
    await call('write', {
      grant: writeGrant,
      path: 'note.txt',
      content: 'saved\n',
      version: current.version,
    });
    assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), 'saved\n');
    const concurrent = (await call('read', { grant: writeGrant, path: 'note.txt' })).version;
    const results = await Promise.allSettled(
      ['first\n', 'second\n'].map((content) =>
        call('write', { grant: writeGrant, path: 'note.txt', content, version: concurrent }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.kind, 'conflict');
    await call('write', {
      grant: writeGrant,
      path: 'created.txt',
      content: 'new\n',
      version: 'missing',
    });
    assert.equal((await call('read', { grant: writeGrant, path: 'created.txt' })).content, 'new\n');
    // Even an explicitly granted repository directory cannot expose its index
    // through this compatibility file surface.
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'add', 'note.txt']);
    const index = await fs.readFile(path.join(root, '.git', 'index'));
    const version = (await call('read', { grant: writeGrant, path: 'note.txt' })).version;
    await call('write', {
      grant: writeGrant,
      path: 'note.txt',
      content: 'worktree only\n',
      version,
    });
    assert.deepEqual(await fs.readFile(path.join(root, '.git', 'index')), index);
    await denied(() =>
      call('write', { grant: writeGrant, path: '.git/index', content: 'no', version: 'missing' }),
    );
    await denied(() =>
      call('grant', { path: path.join(root, '.git'), access: 'read-write', confirmed: true }),
    );
    await call('revoke', { grant: writeGrant });
    await denied(() => call('read', { grant: writeGrant, path: 'note.txt' }));
    await denied(() =>
      call('write', { grant: writeGrant, path: 'note.txt', content: 'no', version }),
    );
    kernel.disconnect('session-a');
    await denied(() => call('read', { grant, path: 'note.txt' }));
    assert.deepEqual(await call('grants'), []);
    assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'private\n');
  } finally {
    kernel.close();
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('replacing an authorized directory does not transfer its authority', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'alune-grant-root-'));
  const root = path.join(base, 'root');
  await fs.mkdir(root);
  const kernel = fileAccessKernel('agent-a'),
    c = {
      sessionId: 'session-a',
      signal: new AbortController().signal,
      sessionSignal: new AbortController().signal,
    };
  try {
    const grant = await kernel.handlers['files.grant'].run(
      { path: root, access: 'read', confirmed: true },
      c,
    );
    await fs.rename(root, root + '-old');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'new'), 'private');
    await assert.rejects(
      () => kernel.handlers['files.read'].run({ grant, path: 'new' }, c),
      (e) => e.kind === 'permission-denied',
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
