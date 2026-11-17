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
const { PartialReads } = require('../dist/modules/git/partial-changes');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const MAX = 2 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const messages = {
  symlink: '符号链接路径请使用整文件操作。',
  nested: '请打开目标文件所在的嵌套仓库后操作。',
  regular: '仅普通文件支持按块或按行操作。',
  size: '文件超过 2 MiB，请使用整文件操作。',
  binary: '二进制文件不支持按块或按行操作。',
  utf8: '仅 UTF-8 文本支持按块或按行操作。',
  stale: '文件、暂存区或 HEAD 已变化，请刷新差异后重新选择。',
};
function proof(name, value) {
  if (process.env.P0_PARTIAL_WORKTREE_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_PARTIAL_WORKTREE_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
let original;
function frozen() {
  if (original) return original;
  const inventory = [], dependencies = [];
  const modules = { 'node:path': require('node:path'), 'node:util': require('node:util'), util: require('node:util') };
  const source = file => {
    const text = fs.readFileSync(path.join(process.env.P0_PARTIAL_WORKTREE_FROZEN, file), 'utf8');
    assert.equal(text, execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }));
    return text;
  };
  const execute = (text, file) => {
    const m = { exports: {} };
    vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module: m, exports: m.exports, require: name => { assert(Object.hasOwn(modules, name), name); return modules[name]; }, Buffer, Error, TextDecoder }, { filename: file });
    return m.exports;
  };
  for (const name of ['repository-path', 'sftp-file']) {
    const file = 'packages/ssh-client/src/' + name + '.ts', text = source(file);
    modules['./' + name] = execute(text, file);
    dependencies.push({ file, sha256: hash(text) });
  }
  const file = 'packages/ssh-client/src/partial-changes.ts', text = source(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const capture = (name, nodes) => {
    assert.equal(nodes.length, 1, name);
    const node = nodes[0];
    inventory.push({ file, name, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, sha256: hash(node.getText(ast)) });
    return node.getText(ast);
  };
  const declarations = ['MAX_BYTES', 'missing', 'PartialChangesError', 'stale', 'Unsupported'].map(name => capture(name, ast.statements.filter(n => n.name?.text === name || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === name))));
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'PartialChanges');
  const methods = ['constructor', 'decode', 'worktree'].map(name => capture('PartialChanges.' + name, klass.members.filter(n => name === 'constructor' ? ts.isConstructorDeclaration(n) : n.name?.getText(ast) === name)));
  original = execute("import {promisify} from 'node:util'; import {joinRepositoryPath} from './repository-path'; import {readSftpChunks} from './sftp-file';\n" + declarations.join('\n') + '\nexport class FrozenWorktree {\n' + methods.join('\n') + '\n}', file).FrozenWorktree;
  proof('worktree-frozen-extraction', { baseline, inventory, dependencies, boundary: 'Original unchanged constructor/decode/worktree and five lexical declarations, two complete original dependency modules. Only worktree receives a new receipt; no new public RPC or decoder/dependency re-credit.' });
  return original;
}
const versions = () => [['frozen', frozen()], ['current', PartialReads]];
function stat(kind, size = 0, mode = 0o100644) {
  return { size, mode, isSymbolicLink: () => kind === 'symlink', isDirectory: () => kind === 'directory', isFile: () => kind === 'file' };
}

test('P0 partial worktree frozen and current enforce ordered path guards bounded reads error identity and handle closure', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    const run = async ({ label, file = 'dir/file', canonical = '/canonical', content = Buffer.from('\ufeff中文\r\nlast'), mode = 0o100644, size = content.length, parent = 'directory', leaf = 'file', nested = false, absent, failureAt, error, statusCode, abortAtRead = false, rootFailure = false }) => {
      const calls = [], reason = new Error('identity ' + label), controller = new AbortController();
      let opened = 0, closed = 0, readBytes = 0;
      const target = canonical + '/' + file;
      const fail = (where, cb) => { if (failureAt === where) { cb(reason); return true; } return false; };
      const sftp = {
        realpath(p, cb) { calls.push(['realpath', p]); assert.equal(p, '/alias'); if (!fail('realpath', cb)) cb(null, canonical); },
        lstat(p, cb) {
          calls.push(['lstat', p]);
          if (fail('lstat:' + p, cb)) return;
          if (absent?.path === p) return cb(Object.assign(new Error('missing'), { code: absent.code }));
          if (p.endsWith('/.git')) return nested ? cb(null, stat(nested)) : cb(Object.assign(new Error('missing'), { code: 'ENOENT' }));
          cb(null, p === target ? stat(leaf, size, mode) : stat(parent));
        },
        open(p, flags, cb) { calls.push(['open', p, flags]); assert.equal(p, target); assert.equal(flags, 'r'); if (fail('open', cb)) return; opened++; cb(null, Buffer.from('handle')); },
        read(handle, buffer, offset, length, position, cb) {
          calls.push(['read', position, length]); assert.equal(handle.toString(), 'handle'); assert.equal(offset, 0); assert.equal(length, 65536);
          if (fail('read', cb)) return;
          const n = Math.min(length, content.length - position); content.copy(buffer, offset, position, position + n); readBytes += n;
          if (abortAtRead && n) controller.abort(reason);
          cb(null, n, buffer);
        },
        close(handle, cb) { calls.push(['close']); assert.equal(handle.toString(), 'handle'); closed++; if (!fail('close', cb)) cb(null); },
      };
      const api = new K({ signal: controller.signal, withSftp(fn) { calls.push(['withSftp']); if (rootFailure) return Promise.reject(reason); return fn(sftp); } });
      let actual;
      if (failureAt || abortAtRead || rootFailure) await assert.rejects(api.worktree('/alias', file), e => e === reason);
      else if (error) await assert.rejects(api.worktree('/alias', file), e => e.message === error && e.statusCode === statusCode);
      else { actual = await api.worktree('/alias', file); assert.deepEqual(plain(actual), absent ? null : { text: content.toString('utf8'), mode: mode & 0o111 ? '100755' : '100644' }); }
      assert.equal(closed, opened, 'every acquired handle closed exactly once');
      if (error && [messages.symlink, messages.nested, messages.regular].includes(error) || absent || error === messages.size && size > MAX || failureAt?.startsWith('lstat') || failureAt === 'realpath') assert.equal(opened, 0);
      if (abortAtRead) { assert.equal(readBytes, 65536); assert.equal(calls.filter(c => c[0] === 'read').length, 1); }
      if (!rootFailure) assert.deepEqual(calls.slice(0, 2), [['withSftp'], ['realpath', '/alias']]);
      if (!rootFailure && failureAt !== 'realpath') assert.deepEqual(calls[2], ['lstat', canonical + '/' + file.split('/')[0]]);
      if (label === 'mixed UTF8 exact') assert.deepEqual(calls.filter(c => c[0] === 'lstat'), [['lstat', '/canonical/dir'], ['lstat', '/canonical/dir/.git'], ['lstat', target]]);
      rows.push({ version, label, file, canonical, contentBytes: content.length, contentSha256: hash(content), statSize: size, mode, parent, leaf, nested, absent, failureAt, abortAtRead, rootFailure, error, statusCode, actual: actual === undefined ? undefined : actual === null ? null : { mode: actual.mode, textBytes: Buffer.byteLength(actual.text), textSha256: hash(actual.text) }, calls, opened, closed, readBytes, failureIdentity: !!(failureAt || abortAtRead || rootFailure) });
    };
    await run({ label: 'mixed UTF8 exact' });
    await run({ label: 'empty file', file: 'empty', content: Buffer.alloc(0) });
    for (const mode of [0o100600, 0o100744, 0o100654, 0o100645]) await run({ label: 'any executable bit ' + mode, mode });
    await run({ label: 'exact 2 MiB', content: Buffer.alloc(MAX, 120) });
    await run({ label: 'stat oversize no open', size: MAX + 1, error: messages.size });
    await run({ label: 'file grows beyond stat', size: 1, content: Buffer.alloc(MAX + 1, 120), error: messages.size });
    await run({ label: 'binary rejected after close', content: Buffer.from([65, 0, 66]), error: messages.binary });
    await run({ label: 'invalid UTF8 rejected after close', content: Buffer.from([0xc3, 0x28]), error: messages.utf8 });
    for (const part of ['parent', 'leaf']) await run({ label: part + ' symlink', ...(part === 'parent' ? { parent: 'symlink' } : { leaf: 'symlink' }), error: messages.symlink });
    await run({ label: 'parent not directory', parent: 'file', error: messages.stale, statusCode: 409 });
    for (const leaf of ['directory', 'socket']) await run({ label: 'leaf ' + leaf, leaf, error: messages.regular });
    for (const nested of ['file', 'directory', 'symlink']) await run({ label: 'nested metadata ' + nested, nested, error: messages.nested });
    for (const part of ['dir', 'dir/file']) for (const code of [2, 'ENOENT']) await run({ label: 'missing ' + part + ' ' + code, absent: { path: '/canonical/' + part, code } });
    for (const failureAt of ['realpath', 'lstat:/canonical/dir', 'lstat:/canonical/dir/.git', 'lstat:/canonical/dir/file', 'open', 'read', 'close']) await run({ label: 'dependency failure ' + failureAt, failureAt });
    await run({ label: 'withSftp failure', rootFailure: true });
    await run({ label: 'abort after first chunk', abortAtRead: true, content: Buffer.alloc(2 * 65536, 120) });
    await run({ label: 'canonical Windows spelling', canonical: 'C:/Repo' });
  }
  proof('worktree-matrix', { rows, boundary: 'Original/current worktree plus actual original/current readSftpChunks and decode; callback filesystem is controlled for stat/growth/error/cancellation/closure branch isolation. No actual race-proof confinement guarantee.' });
});

function diskSnapshot(directory) {
  const files = {}, modes = {}, links = {};
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name), r = path.relative(directory, f); modes[r] = fs.lstatSync(f).mode;
      if (e.isSymbolicLink()) links[r] = fs.readlinkSync(f); else if (e.isDirectory()) walk(f); else if (e.isFile()) files[r] = hash(fs.readFileSync(f));
    }
  }
  walk(directory); return { files, modes, links };
}
async function real(t, ssh) {
  const f = createRepository(), other = createRepository(); t.after(f.close); t.after(other.close);
  let connection;
  if (ssh) { const server = await startSSHServer(); t.after(() => server.close()); connection = new SSHConnection(server.options); connection.on('error', () => {}); await connection.connect(); t.after(() => connection.disconnect()); }
  else { connection = new NativeRepositoryConnection(); t.after(() => connection.close()); }
  const file = "目录/中文 '\"$()\\\n.txt", text = '\ufeff中文\r\nlast';
  f.write(file, text); fs.chmodSync(path.join(f.repo, file), 0o751);
  f.write('empty', ''); f.write('limit', Buffer.alloc(MAX, 120)); f.write('oversize', Buffer.alloc(MAX + 1, 120));
  f.write('binary', Buffer.from([1, 0, 2])); f.write('invalid', Buffer.from([0xc3, 0x28]));
  f.write('plain', 'not a directory'); fs.mkdirSync(path.join(f.repo, 'directory'));
  f.write('nested-file/f', 'nested'); f.write('nested-file/.git', 'gitdir: elsewhere');
  f.write('nested-dir/f', 'nested'); fs.mkdirSync(path.join(f.repo, 'nested-dir/.git'));
  other.write('secret', 'other root\n'); fs.symlinkSync(path.join(other.repo, 'secret'), path.join(f.repo, 'link-file'));
  fs.symlinkSync(other.repo, path.join(f.repo, 'link-dir'), 'dir');
  const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.repo, alias, 'dir');
  const before = diskSnapshot(f.root), otherBefore = diskSnapshot(other.root), rows = [];
  for (const [version, K] of versions()) {
    const api = new K(connection);
    for (const [label, repository, p, expected] of [
      ['special UTF8 executable', f.repo, file, { text, mode: '100755' }],
      ['canonical root alias', alias, file, { text, mode: '100755' }],
      ['empty', f.repo, 'empty', { text: '', mode: '100644' }],
      ['exact limit', f.repo, 'limit', { text: 'x'.repeat(MAX), mode: '100644' }],
      ['missing leaf', f.repo, 'absent', null], ['missing parent', f.repo, 'absent/child', null],
      ['second root isolation', other.repo, 'secret', { text: 'other root\n', mode: '100644' }],
    ]) {
      const actual = await api.worktree(repository, p); assert.deepEqual(plain(actual), expected);
      rows.push({ version, label, repository, file: p, actual: actual ? { mode: actual.mode, textSha256: hash(actual.text), textBytes: Buffer.byteLength(actual.text) } : null });
    }
    for (const [p, message, statusCode] of [['oversize', messages.size], ['binary', messages.binary], ['invalid', messages.utf8], ['directory', messages.regular], ['plain/child', messages.stale, 409], ['link-file', messages.symlink], ['link-dir/secret', messages.symlink], ['nested-file/f', messages.nested], ['nested-dir/f', messages.nested]]) {
      await assert.rejects(api.worktree(f.repo, p), e => e.message === message && e.statusCode === statusCode);
      rows.push({ version, label: 'reject ' + p, message, statusCode });
    }
    assert.deepEqual(diskSnapshot(f.root), before); assert.deepEqual(diskSnapshot(other.root), otherBefore);
    rows.push({ version, label: 'all bytes modes links unchanged', before, after: diskSnapshot(f.root), otherBefore, otherAfter: diskSnapshot(other.root) });
  }
  // Native transport enforces preabort before acquiring any filesystem handle.
  // SSH uses the production signal guard around an already connected transport.
  const controller = new AbortController(), reason = new Error('preabort'); controller.abort(reason);
  const aborted = ssh ? { signal: controller.signal, withSftp: fn => connection.withSftp(fn, controller.signal) } : new NativeRepositoryConnection(controller.signal);
  for (const [version, K] of versions()) {
    await assert.rejects(new K(aborted).worktree(f.repo, file), e => e === reason);
    rows.push({ version, label: 'production transport preabort', reason: reason.message });
  }
  if (!ssh) await aborted.close();
  proof(ssh ? 'worktree-real-ssh' : 'worktree-real-native', { rows, boundary: 'Full original/current worktree, real native filesystem or encrypted loopback SFTP. Static symlink and nested repository guards, special names, exact 2 MiB, encoding, two roots and full fixture bytes/mode/link snapshots; no claim about adversarial path replacement races or external SSH hosts.' });
}
test('P0 partial worktree native reads exact bytes modes boundaries and leaves both roots unchanged', async t => real(t, false));
test('P0 partial worktree SSH reads exact bytes modes boundaries and leaves both roots unchanged', async t => real(t, true));

test('P0 partial worktree SDK keeps helper private and isolates owning repository editable diff reads', async t => {
  const { spawnAgent } = require('@alune/agent-client/node');
  const f = createRepository(), other = createRepository(), state = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-b48-sdk-'));
  t.after(f.close); t.after(other.close); t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  f.write('tracked.txt', '\ufeffcurrent\r\nlast'); other.write('tracked.txt', 'other root\n');
  const child = spawnAgent(process.execPath, [path.join(__dirname, 'settings-fixture.cjs'), state], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } }); t.after(() => child.close());
  try {
    await child.client.initialize();
    const own = (await child.client.registerRepository(f.repo)).resource, second = (await child.client.registerRepository(other.repo)).resource;
    const before = diskSnapshot(f.root), otherBefore = diskSnapshot(other.root), rows = [];
    const read = (resource = own, file = 'tracked.txt') => child.client.readRepository(resource, 'editableDiff', { file, staged: false });
    const preview = await read(), otherPreview = await read(second);
    assert.match(preview.diff, /current/); assert.doesNotMatch(preview.diff, /other root/); assert.equal(typeof preview.revision, 'string');
    assert.match(otherPreview.diff, /other root/); assert.notEqual(preview.revision, otherPreview.revision);
    for (const resource of [{ ...own, agentId: randomUUID() }, { ...own, resourceId: randomUUID() }]) { await assert.rejects(read(resource), e => e.kind === 'not-found'); rows.push({ label: 'foreign resource', kind: 'not-found' }); }
    for (const params of [{ file: '../escape', staged: false }, { file: '.git/config', staged: false }, { file: 'tracked.txt', staged: false, path: other.repo }]) { await assert.rejects(child.client.request('repositories.read', { resource: own, kind: 'editableDiff', params }), e => e.kind === 'invalid-params'); rows.push({ label: 'invalid path or extra path', params, kind: 'invalid-params' }); }
    for (const method of ['partialChanges.worktree', 'worktree', 'git.execute']) { await assert.rejects(child.client.request(method, {}), e => e.kind === 'unknown-method'); rows.push({ label: 'helper remains private', method, kind: 'unknown-method' }); }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(child.client.readRepository(own, 'editableDiff', { file: 'tracked.txt', staged: false }, { signal: controller.signal }), e => e.kind === 'cancelled');
    assert.deepEqual(diskSnapshot(f.root), before); assert.deepEqual(diskSnapshot(other.root), otherBefore);
    proof('worktree-sdk', { own, second, preview, otherPreview, rows, preabort: true, before, after: diskSnapshot(f.root), otherBefore, otherAfter: diskSnapshot(other.root), boundary: 'Current actual stdio SDK consumer integration only. Helper reads have no event or write receipt contract; durable unknown/no automatic replay is covered by separate write/task companions and not counted as new worktree assertions.' });
  } finally { await child.close(); }
});
