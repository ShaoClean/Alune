const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createRepository } = require('./helpers/local-repository.cjs');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { SSHConnection } = require('../dist/adapters/ssh/connection-manager');
const { DiffImages } = require('../dist/modules/git/diff-images');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const MAX = 5 * 1024 * 1024;
const hash = v => createHash('sha256').update(v).digest('hex');
const regular = '仅支持预览普通文件。', sizeMessage = '图片超出预览限制（5 MiB），请在仓库中查看。';
function proof(name, value) {
  if (process.env.P0_IMAGE_WORKTREE_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_IMAGE_WORKTREE_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
let original;
function frozen() {
  if (original) return original;
  const inventory = [], dependencies = [], modules = { util: require('node:util'), 'node:path': require('node:path') };
  const source = file => {
    const text = fs.readFileSync(path.join(process.env.P0_IMAGE_WORKTREE_FROZEN, file), 'utf8');
    assert.equal(text, execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }));
    return text;
  };
  const execute = (text, file) => {
    const m = { exports: {} };
    vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module: m, exports: m.exports, Buffer, Error, require: id => { assert(Object.hasOwn(modules, id), id); return modules[id]; } }, { filename: file });
    return m.exports;
  };
  for (const [id, file] of [['@alune/shared', 'packages/shared/src/types/repository.ts'], ['./repository-path', 'packages/ssh-client/src/repository-path.ts'], ['./sftp-file', 'packages/ssh-client/src/sftp-file.ts']]) {
    const text = source(file); modules[id] = execute(text, file); dependencies.push({ file, sha256: hash(text) });
  }
  const file = 'packages/ssh-client/src/diff-images.ts', text = source(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const capture = (name, nodes) => {
    assert.equal(nodes.length, 1, name); const n = nodes[0];
    inventory.push({ file, name, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1, sha256: hash(n.getText(ast)) }); return n.getText(ast);
  };
  const declarations = ['DiffImageError', 'DiffImageAbsentError', 'limitMessage'].map(name => capture(name, ast.statements.filter(n => n.name?.text === name || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name))));
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'DiffImages');
  const methods = ['constructor', 'readWorktree'].map(name => capture('DiffImages.' + name, klass.members.filter(n => name === 'constructor' ? ts.isConstructorDeclaration(n) : n.name?.getText(ast) === name)));
  original = execute("import {promisify} from 'util'; import {DIFF_IMAGE_MAX_BYTES} from '@alune/shared'; import {joinRepositoryPath} from './repository-path'; import {readSftpChunks} from './sftp-file';\n" + declarations.join('\n') + '\nexport class FrozenImageWorktree {\n' + methods.join('\n') + '\n}', file).FrozenImageWorktree;
  proof('image-worktree-frozen-extraction', { baseline, inventory, dependencies, boundary: 'Five unchanged original AST declarations including constructor/readWorktree, three complete frozen dependency modules. Only readWorktree receives credit.' });
  return original;
}
const versions = () => [['frozen', frozen()], ['current', DiffImages]];
const stat = (kind, size) => ({ size, isFile: () => kind === 'file', isDirectory: () => kind === 'directory', isSymbolicLink: () => kind === 'symlink' });
function scripted({ bytes = Buffer.from([0, 255, 254, 13, 10]), size = bytes.length, canonical = '/canonical', file = 'dir/pixel.png', parent = 'directory', leaf = 'file', failureAt, code, cancelAt, connectionSignal, callerSignal } = {}) {
  const calls = [], controller = new AbortController(), reason = Object.assign(new Error('reason identity'), code === undefined ? {} : { code });
  let opened = 0, closed = 0, readBytes = 0;
  const target = canonical + '/' + file;
  const fail = (where, cb) => { if (cancelAt === where) controller.abort(reason); if (failureAt === where) { cb(reason); return true; } return false; };
  const sftp = {
    realpath(p, cb) { calls.push(['realpath', p]); if (!fail('realpath', cb)) cb(null, canonical); },
    lstat(p, cb) { calls.push(['lstat', p]); if (!fail('lstat:' + p, cb)) cb(null, stat(p === target ? leaf : parent, size)); },
    open(p, flags, cb) { calls.push(['open', p, flags]); assert.equal(p, target); assert.equal(flags, 'r'); if (!fail('open', cb)) { opened++; cb(null, Buffer.from('handle')); } },
    read(handle, buffer, offset, length, position, cb) {
      calls.push(['read', position, length]); assert.equal(handle.toString(), 'handle'); assert.equal(offset, 0); assert.equal(length, 65536);
      if (fail('read', cb)) return;
      const n = Math.min(length, bytes.length - position); bytes.copy(buffer, 0, position, position + n); readBytes += n;
      if (cancelAt === 'chunk' && n || cancelAt === 'eof' && !n) controller.abort(reason);
      cb(null, n, buffer);
    },
    close(handle, cb) { calls.push(['close']); assert.equal(handle.toString(), 'handle'); closed++; if (!fail('close', cb)) cb(null); },
  };
  return { calls, reason, controller, connection: { signal: connectionSignal === false ? undefined : (connectionSignal ?? controller.signal), withSftp(fn) { calls.push(['withSftp']); if (failureAt === 'withSftp') return Promise.reject(reason); return fn(sftp); } },
    run: K => new K({ signal: connectionSignal === false ? undefined : (connectionSignal ?? controller.signal), withSftp(fn) { calls.push(['withSftp']); if (failureAt === 'withSftp') return Promise.reject(reason); return fn(sftp); } }).readWorktree('/alias', file, callerSignal),
    counts: () => ({ opened, closed, readBytes }), bytes };
}
const errorIs = (message, statusCode = 400) => e => e.message === message && e.statusCode === statusCode;

test('P0 image worktree frozen and current preserve bytes bounds error mapping and acknowledged handle closure', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    const run = async (label, options = {}, message, statusCode) => {
      const f = scripted(options); let actual;
      if (message) await assert.rejects(f.run(K), errorIs(message, statusCode));
      else if (options.failureAt) await assert.rejects(f.run(K), e => e === f.reason);
      else { actual = await f.run(K); assert.deepEqual(actual, f.bytes); }
      const counts = f.counts(); assert.equal(counts.opened, counts.closed);
      if (options.size > MAX || options.failureAt?.startsWith('lstat') || options.failureAt === 'realpath' || options.leaf === 'directory' || options.leaf === 'symlink') assert.equal(counts.opened, 0);
      if (!options.failureAt && !message) assert.deepEqual(f.calls.filter(c => c[0] === 'lstat'), version === 'frozen' ? [['lstat', (options.canonical ?? '/canonical') + '/dir/pixel.png']] : [['lstat', (options.canonical ?? '/canonical') + '/dir'], ['lstat', (options.canonical ?? '/canonical') + '/dir/pixel.png']]);
      rows.push({ version, label, options: { ...options, bytes: options.bytes ? { length: options.bytes.length, sha256: hash(options.bytes) } : undefined }, calls: f.calls, ...counts, actual: actual ? { length: actual.length, sha256: hash(actual) } : undefined, message, statusCode: message ? statusCode ?? 400 : undefined, errorIdentity: !!options.failureAt && !message });
    };
    await run('binary bytes'); await run('empty', { bytes: Buffer.alloc(0) }); await run('exact limit', { bytes: Buffer.alloc(MAX, 255) });
    await run('canonical Windows path', { canonical: 'C:/Repo' });
    await run('oversize stat no open', { size: MAX + 1 }, sizeMessage);
    await run('growth despite stat', { size: 1, bytes: Buffer.alloc(MAX + 1, 255) }, sizeMessage);
    for (const leaf of ['directory', 'symlink', 'socket']) await run('reject ' + leaf, { leaf }, regular);
    for (const code of [2, 'ENOENT', 3, 'EACCES']) for (const failureAt of ['realpath', 'lstat:/canonical/dir/pixel.png', 'open', 'read', 'close', 'withSftp'])
      await run('mapped ' + code + ' ' + failureAt, { code, failureAt }, [2, 'ENOENT'].includes(code) ? '此版本没有该图片。' : '无法读取图片：没有读取权限。', [2, 'ENOENT'].includes(code) ? 404 : 400);
    for (const failureAt of ['realpath', 'lstat:/canonical/dir/pixel.png', 'open', 'read', 'close', 'withSftp']) await run('identity ' + failureAt, { failureAt });
    if (version === 'current') for (const parent of ['symlink', 'file', 'socket']) await run('reject parent ' + parent, { parent }, regular);
  }
  proof('image-worktree-matrix', { rows, limit: MAX, boundary: 'Controlled callback SFTP for deterministic growth/error branches. Current intentionally adds parent component checks; original unchanged leaf-only behavior retained.' });
});

test('P0 image worktree cancels caller or connection at filesystem boundaries and retains original divergence', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    for (const cancelAt of ['realpath', 'lstat:/canonical/dir', 'lstat:/canonical/dir/pixel.png', 'chunk', 'eof']) {
      if (version === 'frozen' && cancelAt === 'lstat:/canonical/dir') continue;
      const f = scripted({ bytes: Buffer.alloc(2 * 65536, 42), cancelAt });
      if (version === 'current') await assert.rejects(f.run(K), e => e === f.reason); else assert.deepEqual(await f.run(K), f.bytes);
      assert.equal(f.counts().opened, f.counts().closed);
      if (version === 'current' && cancelAt === 'chunk') assert.equal(f.counts().readBytes, 65536);
      rows.push({ version, cancelAt, outcome: version === 'current' ? 'cancelled exact reason' : 'original ignores connection signal', calls: f.calls, ...f.counts() });
    }
    for (const origin of ['caller', 'connection']) {
      const c = new AbortController(), reason = Object.assign(new Error('abort reason with ENOENT'), { code: 'ENOENT' }); c.abort(reason);
      const f = scripted({ connectionSignal: origin === 'connection' ? c.signal : false, callerSignal: origin === 'caller' ? c.signal : undefined });
      if (version === 'current') { await assert.rejects(f.run(K), e => e === reason); assert.equal(f.calls.length, 0); } else assert.deepEqual(await f.run(K), f.bytes);
      rows.push({ version, origin, phase: 'preabort', outcome: version === 'current' ? 'exact abort reason before SFTP' : 'original ignores signal', calls: f.calls, ...f.counts() });
    }
  }
  // Both signal sources must remain live when combined, including after an awaited callback.
  for (const origin of ['caller', 'connection']) {
    const caller = new AbortController(), connection = new AbortController(), reason = new Error('combined ' + origin), f = scripted({ connectionSignal: connection.signal, callerSignal: caller.signal });
    const base = f.connection.withSftp;
    f.connection.withSftp = fn => base(async sftp => { const read = sftp.read; sftp.read = (...args) => { (origin === 'caller' ? caller : connection).abort(reason); read(...args); }; return fn(sftp); });
    await assert.rejects(new DiffImages(f.connection).readWorktree('/alias', 'dir/pixel.png', caller.signal), e => e === reason);
    assert.equal(f.counts().opened, 1); assert.equal(f.counts().closed, 1);
    rows.push({ version: 'current', phase: 'combined', origin, exactReason: true, calls: f.calls, ...f.counts() });
  }
  proof('image-worktree-cancellation', { rows, boundary: 'Consumer checks at awaited filesystem and chunk/EOF boundaries; no immediate interrupt of an unreturned SFTP callback or process-tree kill claim. Frozen signal omission is explicit.' });
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
  const file = "目录/中文 '\"$()\\\n.png", bytes = Buffer.from([0, 255, 254, 13, 10]);
  f.write(file, bytes); fs.chmodSync(path.join(f.repo, file), 0o751);
  f.write('empty.png', Buffer.alloc(0)); f.write('limit.png', Buffer.alloc(MAX, 255)); f.write('oversize.png', Buffer.alloc(MAX + 1, 255));
  fs.mkdirSync(path.join(f.repo, 'directory.png')); f.write('plain.png', bytes);
  other.write('secret.png', Buffer.from([0, 255, 42])); fs.symlinkSync(path.join(other.repo, 'secret.png'), path.join(f.repo, 'link.png'));
  fs.symlinkSync(other.repo, path.join(f.repo, 'outside'), 'dir'); fs.symlinkSync(f.repo, path.join(f.root, 'alias'), 'dir');
  const before = snapshot(f.root), otherBefore = snapshot(other.root), rows = [];
  for (const [version, K] of versions()) {
    const api = new K(connection);
    for (const [label, repository, name, expected] of [
      ['special binary', f.repo, file, bytes], ['root alias', path.join(f.root, 'alias'), file, bytes],
      ['empty', f.repo, 'empty.png', Buffer.alloc(0)], ['exact limit', f.repo, 'limit.png', Buffer.alloc(MAX, 255)],
      ['second root', other.repo, 'secret.png', Buffer.from([0, 255, 42])],
    ]) {
      const actual = await api.readWorktree(repository, name); assert.deepEqual(actual, expected);
      rows.push({ version, label, file: name, actual: { length: actual.length, sha256: hash(actual) } });
    }
    for (const [name, message, statusCode] of [['oversize.png', sizeMessage, 400], ['directory.png', regular, 400], ['link.png', regular, 400], ['missing.png', '此版本没有该图片。', 404], ['missing/child.png', '此版本没有该图片。', 404]]) {
      await assert.rejects(api.readWorktree(f.repo, name), errorIs(message, statusCode)); rows.push({ version, label: 'reject ' + name, message, statusCode });
    }
    if (version === 'frozen') { const actual = await api.readWorktree(f.repo, 'outside/secret.png'); assert.deepEqual(actual, Buffer.from([0, 255, 42])); rows.push({ version, label: 'parent symlink regression', outcome: 'original reads outside root', sha256: hash(actual) }); }
    else { await assert.rejects(api.readWorktree(f.repo, 'outside/secret.png'), errorIs(regular)); rows.push({ version, label: 'parent symlink regression', outcome: 'current rejects before read' }); }
    const controller = new AbortController(), reason = new Error('explicit real preabort'); controller.abort(reason);
    if (version === 'current') { await assert.rejects(api.readWorktree(f.repo, file, controller.signal), e => e === reason); rows.push({ version, label: 'explicit real preabort', outcome: 'exact reason' }); }
    else { assert.deepEqual(await api.readWorktree(f.repo, file, controller.signal), bytes); rows.push({ version, label: 'explicit real preabort', outcome: 'original ignores signal' }); }
    assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(other.root), otherBefore);
  }
  proof(ssh ? 'image-worktree-real-ssh' : 'image-worktree-real-native', { rows, before, after: snapshot(f.root), otherBefore, otherAfter: snapshot(other.root), boundary: 'Real native filesystem or encrypted local loopback SSH with both unchanged original helper and current helper. Entire two roots bytes/modes/links unchanged. No adversarial concurrent path replacement claim.' });
}
test('P0 image worktree real native preserves binary boundaries and rejects cross-root directory symlinks', async t => real(t, false));
test('P0 image worktree real SSH preserves binary boundaries and rejects cross-root directory symlinks', async t => real(t, true));

test('P0 image worktree SDK isolates owning resources rejects parent symlinks and keeps helper private', async t => {
  const { spawnAgent } = require('@alune/agent-client/node'), f = createRepository(), other = createRepository(), state = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-b49-sdk-'));
  t.after(f.close); t.after(other.close); t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  f.write('pixel.png', Buffer.from([0, 255, 1])); other.write('pixel.png', Buffer.from([0, 255, 2])); fs.symlinkSync(other.repo, path.join(f.repo, 'outside'), 'dir');
  const child = spawnAgent(process.execPath, [path.join(__dirname, 'settings-fixture.cjs'), state], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } }); t.after(() => child.close());
  try {
    const init = await child.client.initialize(), own = (await child.client.registerRepository(f.repo)).resource, second = (await child.client.registerRepository(other.repo)).resource;
    assert.equal(own.agentId, init.agentId); const before = snapshot(f.root), otherBefore = snapshot(other.root), rows = [];
    for (const [resource, bytes] of [[own, Buffer.from([0, 255, 1])], [second, Buffer.from([0, 255, 2])]]) {
      const dto = await child.client.readRepository(resource, 'diffImage', { file: 'pixel.png', side: 'after' }); assert.deepEqual(Buffer.from(dto.content, 'base64'), bytes); assert.equal(dto.byteLength, bytes.length); assert.equal(dto.mediaType, 'image/png'); assert.equal(dto.path, 'pixel.png'); assert.equal(dto.side, 'after'); rows.push({ resource, dto });
    }
    await assert.rejects(child.client.readRepository(own, 'diffImage', { file: 'outside/pixel.png', side: 'after' }), e => /普通文件/.test(e.message));
    for (const resource of [{ ...own, agentId: randomUUID() }, { ...own, resourceId: randomUUID() }]) await assert.rejects(child.client.readRepository(resource, 'diffImage', { file: 'pixel.png', side: 'after' }), e => e.kind === 'not-found');
    for (const params of [{ file: '../pixel.png', side: 'after' }, { file: '.git/config.png', side: 'after' }, { file: 'pixel.png', side: 'after', path: other.repo }]) await assert.rejects(child.client.request('repositories.read', { resource: own, kind: 'diffImage', params }), e => e.kind === 'invalid-params');
    for (const method of ['diffImages.readWorktree', 'readWorktree', 'git.execute']) await assert.rejects(child.client.request(method, {}), e => e.kind === 'unknown-method');
    const controller = new AbortController(); controller.abort(); await assert.rejects(child.client.readRepository(own, 'diffImage', { file: 'pixel.png', side: 'after' }, { signal: controller.signal }), e => e.kind === 'cancelled');
    assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(other.root), otherBefore);
    proof('image-worktree-sdk', { own, second, rows, parentSymlinkRejected: true, foreignResourceRejected: true, strictParams: true, helperRpcAbsent: true, preabort: true, before, after: snapshot(f.root), otherBefore, otherAfter: snapshot(other.root), boundary: 'Actual current stdio SDK consumer only. No complete frozen SDK comparison or arbitrary remote-host claim. Durable unknown/no replay belongs to independent companion tests.' });
  } finally { await child.close(); }
});
