const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { AgentState } = require('../dist/adapters/sqlite/state');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-state-'));
  const f = { root, id: randomUUID(), store: null };
  t.after(async () => {
    await f.store?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  f.store = await AgentState.open(root, f.id);
  return f;
}
const activeFile = (f) =>
  path.join(f.root, 'state/generations', f.store.generation, 'state.sqlite');
function put(store, value) {
  const doc = store.document('fixture');
  doc.read();
  doc.write(value);
}

test(
  'state documents use revision CAS and resource IDs survive a restart',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const a = f.store.document('settings');
    const b = f.store.document('settings');
    assert.equal(a.read(), null);
    assert.equal(b.read(), null);
    a.write({ language: 'zh-CN', models: ['中文'] });
    assert.throws(
      () => b.write({ language: 'en' }),
      (e) => e.kind === 'conflict',
    );
    assert.equal(b.read().language, 'zh-CN');
    b.write({ language: 'en' });
    const id = f.store.resource('repository', 'local:/fixture');
    await f.store.close();
    f.store = await AgentState.open(f.root, f.id);
    assert.equal(f.store.document('settings').read().language, 'en');
    assert.equal(f.store.resource('repository', 'local:/fixture'), id);
    await assert.rejects(AgentState.open(f.root, f.id), (e) => e.kind === 'busy');
  },
);

test(
  'real process crash releases the writer and marks unfinished operations unknown',
  { timeout: 30000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-state-crash-'));
    const id = randomUUID();
    const child = spawn(process.execPath, [path.join(__dirname, 'state-holder.cjs')], {
      env: { ...process.env, ALUNE_STATE_FIXTURE_DIR: root, ALUNE_STATE_FIXTURE_ID: id },
    });
    let output = '',
      errors = '';
    child.stdout.on('data', (b) => {
      output += b;
    });
    child.stderr.on('data', (b) => {
      errors += b;
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    let store;
    t.after(async () => {
      child.kill('SIGKILL');
      await exited;
      await store?.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const deadline = Date.now() + 20000;
    while (!output.includes('ready')) {
      assert.equal(child.exitCode, null, errors);
      assert(Date.now() < deadline, 'holder did not start');
      await new Promise((r) => setTimeout(r, 10));
    }
    await assert.rejects(AgentState.open(root, id), (e) => e.kind === 'busy');
    child.kill('SIGKILL');
    await exited;
    store = await AgentState.open(root, id);
    assert.deepEqual(store.document('fixture').read(), { saved: 'before-kill' });
    assert.equal(
      store.database.prepare('SELECT state FROM operations WHERE id=?').get('interrupted').state,
      'unknown',
    );
  },
);

test(
  'backup/restore publishes a new generation, retains the previous data and never touches repository files',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const repositoryFile = path.join(f.root, 'user-worktree.txt');
    fs.writeFileSync(repositoryFile, 'uncommitted changes');
    put(f.store, { value: 1, repositoryFile });
    const original = f.store.generation;
    const backup = await f.store.backup();
    put(f.store, { value: 2, repositoryFile });
    await assert.rejects(AgentState.restore(f.root, f.id, backup), (e) => e.kind === 'busy');
    await f.store.close();
    const result = await AgentState.restore(f.root, f.id, backup);
    assert.equal(result.previous, original);
    assert.notEqual(result.generation, original);
    f.store = await AgentState.open(f.root, f.id);
    assert.equal(f.store.document('fixture').read().value, 1);
    const previous = new Database(
      path.join(f.root, 'state/generations', original, 'state.sqlite'),
      { readonly: true },
    );
    try {
      assert.equal(
        JSON.parse(previous.prepare('SELECT body FROM documents WHERE name=?').get('fixture').body)
          .value,
        2,
      );
    } finally {
      previous.close();
    }
    assert.equal(fs.readFileSync(repositoryFile, 'utf8'), 'uncommitted changes');
  },
);

test(
  'damaged database and pointer are retained and recover only through explicit validated restore',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    put(f.store, { retained: true });
    const backup = await f.store.backup();
    const damaged = activeFile(f);
    await f.store.close();
    fs.writeFileSync(damaged, 'damaged state');
    await assert.rejects(AgentState.open(f.root, f.id));
    assert.equal(fs.readFileSync(damaged, 'utf8'), 'damaged state');
    const pointer = path.join(f.root, 'state/current.json');
    fs.writeFileSync(pointer, 'broken pointer');
    fs.writeFileSync(path.join(f.root, 'state/initializing.json'), 'broken initial marker');
    await assert.rejects(AgentState.open(f.root, f.id), (e) => e.kind === 'corrupt');
    await AgentState.restore(f.root, f.id, backup);
    f.store = await AgentState.open(f.root, f.id);
    assert.deepEqual(f.store.document('fixture').read(), { retained: true });
    assert.equal(fs.readFileSync(damaged, 'utf8'), 'damaged state');
    assert(
      fs
        .readdirSync(path.join(f.root, 'recovery'))
        .some(
          (name) =>
            fs.readFileSync(path.join(f.root, 'recovery', name), 'utf8') === 'broken pointer',
        ),
    );
    assert(
      fs
        .readdirSync(path.join(f.root, 'recovery'))
        .some(
          (name) =>
            fs.readFileSync(path.join(f.root, 'recovery', name), 'utf8') ===
            'broken initial marker',
        ),
    );
  },
);

test(
  'empty active databases and unsupported schemas are not silently initialized',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const file = activeFile(f);
    await f.store.close();
    const db = new Database(file);
    db.pragma('user_version = 999');
    db.close();
    const future = fs.readFileSync(file);
    await assert.rejects(AgentState.open(f.root, f.id), (e) => e.kind === 'corrupt');
    assert.deepEqual(fs.readFileSync(file), future);
    fs.writeFileSync(file, '');
    await assert.rejects(AgentState.open(f.root, f.id), (e) => e.kind === 'corrupt');
    assert.equal(fs.statSync(file).size, 0);
  },
);

test(
  'checksum mismatch and foreign identity cannot replace active state',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    put(f.store, { original: true });
    const backup = await f.store.backup();
    const active = fs.readFileSync(path.join(f.root, 'state/current.json'));
    await f.store.close();
    await assert.rejects(
      AgentState.restore(f.root, randomUUID(), backup),
      (e) => e.kind === 'corrupt',
    );
    fs.appendFileSync(path.join(backup, 'state.sqlite'), 'tampered');
    await assert.rejects(AgentState.restore(f.root, f.id, backup), (e) => e.kind === 'corrupt');
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'state/current.json')), active);
  },
);

test(
  'backup cancellation cleans partial snapshots and repeated close waits for the same work',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    put(f.store, { payload: 'x'.repeat(2 * 1024 * 1024) });
    const controller = new AbortController();
    const pending = f.store.backup(controller.signal);
    controller.abort();
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'backups')), []);
    const backup = f.store.backup();
    const first = f.store.close();
    const second = f.store.close();
    assert.equal(first, second);
    await backup;
    await second;
    assert.throws(
      () => f.store.document('fixture').read(),
      (e) => e.kind === 'unavailable',
    );
    f.store = await AgentState.open(f.root, f.id);
  },
);

test(
  'private state permissions are real POSIX modes or a protected Windows DACL',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const file = activeFile(f);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(f.root).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } else {
      const script =
        '$a=Get-Acl -LiteralPath $env:ALUNE_ACL_TEST_PATH; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{Protected=$a.AreAccessRulesProtected;Owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;User=$sid;Rules=@($a.Access|ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress';
      const result = JSON.parse(
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          { env: { ...process.env, ALUNE_ACL_TEST_PATH: file }, encoding: 'utf8' },
        ),
      );
      assert.equal(result.Protected, true);
      assert.equal(result.Owner, result.User);
      assert(result.Rules.every((sid) => sid === result.User || sid === 'S-1-5-18'));
    }
  },
);

test(
  'directory junctions and hardlinked databases cannot escape private state ownership',
  { timeout: 30000 },
  async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-state-links-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const target = path.join(base, 'target');
    fs.mkdirSync(target);
    const link = path.join(base, 'link');
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(AgentState.open(link, randomUUID()), (e) => e.kind === 'permission');
    assert.deepEqual(fs.readdirSync(target), []);
    const f = await fixture(t);
    const file = activeFile(f);
    await f.store.close();
    const alias = path.join(base, 'alias.sqlite');
    fs.linkSync(file, alias);
    await assert.rejects(AgentState.open(f.root, f.id), (e) => e.kind === 'permission');
  },
);
