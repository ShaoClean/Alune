const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { createRepository } = require('./helpers/local-repository.cjs');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { SSHConnection } = require('../dist/adapters/ssh/connection-manager');
const { GitLfs } = require('../dist/modules/git/lfs');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = value => createHash('sha256').update(value).digest('hex');
const result = (stdout = '', exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const attrs = (input, value = 'unspecified') => input.toString('utf8').split('\0').filter(Boolean).map(file => file + '\0filter\0' + value + '\0').join('');
const paths = Array.from({ length: 301 }, (_, i) => `目录 ${i}/中文 [*] '\"$()\\\n${'x'.repeat(64)}.bin`);
const list = paths.join('\0') + '\0';
function proof(name, value) {
  if (process.env.P0_LFS_ATTRIBUTES_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_LFS_ATTRIBUTES_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
let original;
function frozen() {
  if (original) return original;
  const dependencies = [], inventory = [], modules = {};
  const source = file => {
    const text = fs.readFileSync(path.join(process.env.P0_LFS_ATTRIBUTES_FROZEN, file), 'utf8');
    assert.equal(text, execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }));
    return text;
  };
  const execute = (text, file) => {
    const m = { exports: {} };
    vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module: m, exports: m.exports, Buffer, Error, AbortController, AbortSignal, require: id => { assert(Object.hasOwn(modules, id), id); return modules[id]; } }, { filename: file });
    return m.exports;
  };
  for (const [id, file] of [['./git-shell', 'packages/ssh-client/src/git-shell.ts'], ['./repository-transport', 'packages/ssh-client/src/repository-transport.ts']]) {
    const text = source(file); modules[id] = execute(text, file); dependencies.push({ file, sha256: hash(text) });
  }
  const file = 'packages/ssh-client/src/lfs.ts', text = source(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const capture = (name, nodes) => {
    assert.equal(nodes.length, 1, name); const n = nodes[0];
    inventory.push({ file, name, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1, sha256: hash(n.getText(ast)) }); return n.getText(ast);
  };
  const declarations = ['ATTRIBUTE_BATCH_BYTES', 'ATTRIBUTE_CONCURRENCY', 'attributeBatches'].map(name => capture(name, ast.statements.filter(n => n.name?.text === name || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name))));
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GitLfs');
  const currentText = fs.readFileSync(path.join(root, 'packages/agent/src/modules/git/lfs.ts'), 'utf8'), currentAst = ts.createSourceFile('current.ts', currentText, ts.ScriptTarget.Latest, true), currentClass = currentAst.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GitLfs');
  const methods = ['constructor', 'hasLfsAttributes'].map(name => {
    const select = n => name === 'constructor' ? ts.isConstructorDeclaration(n) : n.name?.getText() === name;
    const text = capture('GitLfs.' + name, klass.members.filter(select));
    assert.equal(currentClass.members.find(select).getText(currentAst), text, 'Selected production method changed'); return text;
  });
  original = execute("import {runGit, type RepositoryTransport} from './repository-transport';\n" + declarations.join('\n') + '\nexport class FrozenLfsAttributes {\n' + methods.join('\n') + '\n}', file).FrozenLfsAttributes;
  proof('lfs-attributes-frozen-extraction', { baseline, inventory, dependencies, currentSelectedMethodsByteIdentical: true, boundary: 'Five unchanged original declarations; two complete original runtime dependencies. Exactly hasLfsAttributes credit; status and readObject excluded.' });
  return original;
}
const versions = () => [['frozen', frozen()], ['current', GitLfs]];
function harness(check = async input => { await nextTurn(); return result(attrs(input)); }, signal) {
  const calls = [], completed = []; let active = 0, peak = 0;
  const connection = { signal, withSftp() { throw Error('unexpected SFTP'); }, execCommand() { throw Error('unexpected shell'); },
    async execGit(repo, args, combined, options) {
      const i = calls.length, input = Buffer.from(options.stdin);
      assert.deepEqual(Array.from(args), ['check-attr', '-z', '--stdin', 'filter']);
      assert.deepEqual(Object.keys(options), ['stdin']);
      assert(input.length > 0 && input.length <= 4096); assert.equal(input.at(-1), 0);
      assert.equal(combined.aborted, false);
      calls.push({ repo, args: Array.from(args), input: input.toString('base64'), byteLength: input.length, sha256: hash(input) });
      peak = Math.max(peak, ++active);
      try { const r = await check(input, combined, i); calls[i].stdout = r.stdout; calls[i].exitCode = r.exitCode; calls[i].stderr = r.stderr; return r; }
      catch (e) { calls[i].error = e.message; throw e; }
      finally { active--; completed.push(i); calls[i].abortedAtCompletion = combined.aborted; }
    },
  };
  return { connection, calls, completed, counts: () => ({ active, peak }), checked: () => calls.flatMap(c => Buffer.from(c.input, 'base64').toString('utf8').split('\0').filter(Boolean)) };
}

test('P0 LFS attributes frozen and current preserve NUL paths byte batches exact triplets and bounded concurrency', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    for (const [label, files] of [
      ['empty', ''], ['only separators', '\0\0'], ['single unterminated', 'one.bin'],
      ['special names', "中文 '\"$()\\\n[*].bin\0lfs\0filter\0\0last\0"],
      ['exact 4096 bytes', 'x'.repeat(4095) + '\0'],
      ['boundary and Unicode', 'x'.repeat(4095) + '\0中\0末\0'],
      ['large multi-batch list', list],
    ]) {
      const f = harness(); assert.equal(await new K(f.connection).hasLfsAttributes('/repo test', files), false);
      assert.deepEqual(f.checked(), files.split('\0').filter(Boolean));
      assert.equal(f.counts().active, 0); assert(f.counts().peak <= 2);
      if (label === 'large multi-batch list') { assert(f.calls.length > 2); assert.equal(f.counts().peak, 2); }
      if (label === 'exact 4096 bytes') { assert.equal(f.calls.length, 1); assert.equal(f.calls[0].byteLength, 4096); }
      rows.push({ version, label, input: files, expected: false, calls: f.calls, ...f.counts() });
    }
    for (const [label, output, expected] of [
      ['value lfs', 'a\0filter\0lfs\0', true],
      ['last value lfs', 'a\0filter\0unspecified\0b\0filter\0lfs\0', true],
      ['filename lfs', 'lfs\0filter\0unspecified\0', false],
      ['attribute lfs', 'a\0lfs\0set\0', false],
      ['other values', 'a\0filter\0set\0b\0filter\0unset\0c\0filter\0unspecified\0', false],
      ['case sensitive', 'a\0filter\0LFS\0', false],
      ['whitespace significant', 'a\0filter\0lfs \0', false],
      ['empty output', '', false],
      ['unterminated triplet value', 'a\0filter\0lfs', true],
    ]) {
      const f = harness(async () => result(output));
      assert.equal(await new K(f.connection).hasLfsAttributes('C:/Repository', 'a\0'), expected);
      assert.equal(f.calls.length, 1); rows.push({ version, label, input: 'a\0', expected, calls: f.calls, ...f.counts() });
    }
    for (const files of ['x'.repeat(4096) + '\0', '中'.repeat(1366) + '\0', 'ok\0' + 'x'.repeat(4096) + '\0']) {
      const f = harness(); await assert.rejects(new K(f.connection).hasLfsAttributes('/repo', files), /文件路径过长/);
      assert.equal(f.calls.length, 0); rows.push({ version, label: 'oversized path before any dispatch', inputBytes: Buffer.byteLength(files), calls: f.calls, rejected: true });
    }
  }
  proof('lfs-attributes-matrix', { rows, limit: 4096, concurrency: 2, boundary: 'Controlled structured execGit; parsing also preserves original unterminated triplet behavior, no malformed-output validation claim.' });
});

test('P0 LFS attributes frozen and current cancel siblings stop queued work and preserve failures', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    for (const foundAt of [0, 1, 3]) {
      let siblingDone = false;
      const f = harness(async (input, signal, i) => {
        if (i % 2 === 1) { await nextTurn(); siblingDone = true; }
        return result(attrs(input, i === foundAt ? 'lfs' : 'unspecified'));
      });
      assert.equal(await new K(f.connection).hasLfsAttributes('/repo', list), true);
      assert(siblingDone); assert.equal(f.counts().active, 0); assert.equal(f.counts().peak, 2);
      // The first batch can finish while the other worker is waiting; after
      // success every dispatch must have occurred before the successful return.
      const successful = f.calls.findIndex(c => c.stdout.includes('\0lfs\0'));
      assert.equal(successful, foundAt); assert(f.calls.length < 10);
      const dispatches = f.calls.length; await nextTurn(); assert.equal(f.calls.length, dispatches);
      if (foundAt === 0) assert.equal(dispatches, 2);
      rows.push({ version, label: 'early LFS at ' + foundAt, expected: true, calls: f.calls, completed: f.completed, drained: true, ...f.counts() });
    }
    for (const failure of ['stderr', 'empty stderr', 'transport', 'connection']) {
      const c = new AbortController(), reason = Object.assign(new Error('identity ' + failure), { code: 'ENOENT' });
      let abortedSibling = 0;
      const f = harness(async (input, signal, i) => {
        if (i === 0) { await nextTurn(); if (failure === 'connection') c.abort(reason); if (failure === 'connection' || failure === 'transport') throw reason; return result('', 1, failure === 'stderr' ? 'attribute denied\n' : ''); }
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { abortedSibling++; reject(signal.reason); }, { once: true }));
      }, c.signal);
      await assert.rejects(new K(f.connection).hasLfsAttributes('/repo', list), e => failure === 'stderr' ? e.message === 'attribute denied\n' : failure === 'empty stderr' ? e.message === '无法检测 LFS 属性。' : e === reason);
      await nextTurn(); assert.equal(f.calls.length, 2); assert.equal(abortedSibling, 1); assert.equal(f.counts().active, 0);
      rows.push({ version, label: failure, calls: f.calls, abortedSibling, exactReason: ['transport', 'connection'].includes(failure), ...f.counts() });
    }
    // A transport may return success after its connection was cancelled.
    for (const output of ['lfs', 'unspecified']) {
      const c = new AbortController(), reason = new Error('cancel before consuming returned output');
      const f = harness(async input => { c.abort(reason); return result(attrs(input, output)); }, c.signal);
      await assert.rejects(new K(f.connection).hasLfsAttributes('/repo', 'a\0'), e => e === reason);
      assert.equal(f.calls.length, 1); rows.push({ version, label: 'cancelled completed output ' + output, exactReason: true, calls: f.calls, ...f.counts() });
    }
    for (const files of ['', list]) {
      const c = new AbortController(), reason = new Error('preaborted'); c.abort(reason); const f = harness(undefined, c.signal);
      if (files) await assert.rejects(new K(f.connection).hasLfsAttributes('/repo', files), e => e === reason);
      else assert.equal(await new K(f.connection).hasLfsAttributes('/repo', files), false);
      assert.equal(f.calls.length, 0); rows.push({ version, label: files ? 'nonempty preabort' : 'empty preabort returns false', calls: f.calls, exactReason: !!files });
    }
    // A concurrent failure overrides another batch's positive result.
    const f = harness(async (input, signal, i) => { if (i === 0) return result(attrs(input, 'lfs')); await nextTurn(); return result('', 1, 'sibling failure'); });
    await assert.rejects(new K(f.connection).hasLfsAttributes('/repo', list), /sibling failure/);
    assert.equal(f.calls.length, 2); rows.push({ version, label: 'inflight failure after positive result', calls: f.calls, ...f.counts() });
  }
  proof('lfs-attributes-cancellation', { rows, boundary: 'Failure aborts cooperative sibling and blocks queue. Empty preaborted list intentionally returns false without commands, as original. Does not prove waiting for noncooperative transport cleanup or process-tree termination.' });
});

function snapshot(directory) {
  const files = {}, modes = {}, links = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name), r = path.relative(directory, f); modes[r] = fs.lstatSync(f).mode; if (e.isSymbolicLink()) links[r] = fs.readlinkSync(f); else if (e.isDirectory()) walk(f); else if (e.isFile()) files[r] = hash(fs.readFileSync(f)); } };
  walk(directory); return { files, modes, links };
}
async function real(t, ssh) {
  const f = createRepository(), other = createRepository(); t.after(f.close); t.after(other.close);
  let connection;
  if (ssh) { const server = await startSSHServer(); t.after(() => server.close()); connection = new SSHConnection(server.options); connection.on('error', () => {}); await connection.connect(); t.after(() => connection.disconnect()); }
  else { connection = new NativeRepositoryConnection(); t.after(() => connection.close()); }
  const special = "目录/中文 '\"$()\\\n[*].bin";
  f.write(special, Buffer.from([0, 255, 13, 10])); fs.chmodSync(path.join(f.repo, special), 0o751);
  f.write('.gitattributes', '*.bin filter=lfs\n*.txt -filter\n*.dat filter=other\n');
  f.write('normal.txt'); f.write('other.dat'); f.write('lfs');
  for (const name of paths) f.write(name);
  other.write(special); other.write('.gitattributes', '*.bin filter=other\n');
  const before = snapshot(f.root), otherBefore = snapshot(other.root), rows = [];
  for (const [version, K] of versions()) {
    for (const [label, repo, files, expected] of [
      ['empty', f.repo, '', false], ['literal filename lfs', f.repo, 'lfs\0', false],
      ['special Unicode binary', f.repo, special + '\0', true],
      ['non-LFS values', f.repo, 'normal.txt\0other.dat\0', false],
      ['many paths LFS', f.repo, list, true],
      ['many paths other root', other.repo, list, false],
      ['late LFS', f.repo, paths.map(n => n + '.txt').join('\0') + '\0' + special + '\0', true],
      ['same name second repository', other.repo, special + '\0', false],
    ]) {
      const calls = [], wrapped = { signal: connection.signal,
        ...(connection.execGit ? { execGit: async (...args) => { const r = await connection.execGit(...args); calls.push({ repo: args[0], argv: Array.from(args[1]), input: args[3].stdin.toString('base64'), stdout: r.stdout, exitCode: r.exitCode, stderr: r.stderr }); return r; } } : {}),
        execCommand: async (...args) => { const r = await connection.execCommand(...args); calls.push({ command: args[0], input: args[3].stdin.toString('base64'), stdout: r.stdout, exitCode: r.exitCode, stderr: r.stderr }); return r; },
      };
      assert.equal(await new K(wrapped).hasLfsAttributes(repo, files), expected);
      for (const call of calls) { assert.equal(call.exitCode, 0); assert(Buffer.from(call.input, 'base64').length <= 4096); }
      if (label === 'many paths other root') { assert(calls.length > 2); assert.deepEqual(calls.flatMap(c => Buffer.from(c.input, 'base64').toString('utf8').split('\0').filter(Boolean)).sort(), [...paths].sort()); }
      rows.push({ version, label, repo, input: files, expected, calls });
    }
    const c = new AbortController(), reason = new Error('real preabort'); c.abort(reason);
    const wrapped = { signal: c.signal, execGit() { throw Error('preabort dispatched'); }, execCommand() { throw Error('preabort dispatched'); } };
    await assert.rejects(new K(wrapped).hasLfsAttributes(f.repo, special + '\0'), e => e === reason);
    rows.push({ version, label: 'preabort exact reason before dispatch', exactReason: true });
    assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(other.root), otherBefore);
  }
  proof(ssh ? 'lfs-attributes-real-ssh' : 'lfs-attributes-real-native', { rows, before, after: snapshot(f.root), otherBefore, otherAfter: snapshot(other.root), boundary: 'Real Git behind NativeRepositoryConnection or encrypted local-loopback SSHConnection; original full transport/shell dependencies, current real production helper. Two temporary roots byte/mode/link identical. No external host claim.' });
}
test('P0 LFS attributes real native scans match frozen helper with unchanged repository bytes', async t => real(t, false));
test('P0 LFS attributes real SSH scans match frozen helper with unchanged repository bytes', async t => real(t, true));

test('P0 LFS attributes actual SDK isolates owning resources and exposes no helper RPC', async t => {
  const { spawnAgent } = require('@alune/agent-client/node'), f = createRepository(), other = createRepository(), state = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-b50-sdk-'));
  t.after(f.close); t.after(other.close); t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  f.write('pixel.bin', 'one'); other.write('pixel.bin', 'two'); f.write('.gitattributes', '*.bin filter=lfs\n'); other.write('.gitattributes', '*.bin filter=other\n');
  const child = spawnAgent(process.execPath, [path.join(__dirname, 'settings-fixture.cjs'), state], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } }); t.after(() => child.close());
  try {
    const init = await child.client.initialize(), own = (await child.client.registerRepository(f.repo)).resource, second = (await child.client.registerRepository(other.repo)).resource;
    assert.equal(own.agentId, init.agentId); const before = snapshot(f.root), otherBefore = snapshot(other.root), rows = [];
    const version = spawnSync('git', ['lfs', 'version'], { encoding: 'utf8' });
    for (const [resource, used] of [[own, true], [second, false]]) {
      const dto = await child.client.readRepository(resource, 'lfs', {});
      const installed = version.status === 0;
      assert.deepEqual(dto, { used, installed, ...(installed ? { version: version.stdout.trim() } : {}), ...(used && !installed ? { message: '此仓库使用 Git LFS，但仓库所在主机未安装 git-lfs。请在该主机安装并运行 git lfs install。' } : {}) });
      rows.push({ resource, dto });
    }
    for (const resource of [{ ...own, agentId: randomUUID() }, { ...own, resourceId: randomUUID() }]) await assert.rejects(child.client.readRepository(resource, 'lfs', {}), e => e.kind === 'not-found');
    await assert.rejects(child.client.request('repositories.read', { resource: own, kind: 'lfs', params: { path: other.repo } }), e => e.kind === 'invalid-params');
    for (const method of ['gitLfs.hasLfsAttributes', 'hasLfsAttributes', 'git.execute']) await assert.rejects(child.client.request(method, {}), e => e.kind === 'unknown-method');
    const controller = new AbortController(); controller.abort(); await assert.rejects(child.client.readRepository(own, 'lfs', {}, { signal: controller.signal }), e => e.kind === 'cancelled');
    assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(other.root), otherBefore);
    proof('lfs-attributes-sdk', { rows, own, second, foreignResourceRejected: true, strictParams: true, helperRpcAbsent: true, preabort: true, before, after: snapshot(f.root), otherBefore, otherAfter: snapshot(other.root), boundary: 'Actual current stdio SDK consumer only; no full frozen SDK/status credit. Helper has no events or mutation receipts; unknown/no automatic replay only separate companion regression.' });
  } finally { await child.close(); }
});
