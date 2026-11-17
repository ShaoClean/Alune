const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setImmediate: turn } = require('node:timers/promises');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { InteractiveRebase } = require('../dist/modules/git/interactive-rebase');
const { createRepository } = require('./helpers/local-repository.cjs');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
function proof(name, value) { if (process.env.P0_LOCAL_PATH_PROBES_PROOF_DIR) fs.writeFileSync(path.join(process.env.P0_LOCAL_PATH_PROBES_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
let original;
function frozen() {
  if (original) return original;
  const file = 'packages/ssh-client/src/local-connection.ts';
  const text = fs.readFileSync(path.join(process.env.P0_LOCAL_PATH_PROBES_FROZEN, file), 'utf8');
  assert.equal(text, execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }));
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'LocalConnection');
  const inventory = [];
  const members = ['constructor', 'execCommand', 'hasAnyPath'].map(name => {
    const matches = klass.members.filter(n => name === 'constructor' ? ts.isConstructorDeclaration(n) : n.name?.getText(ast) === name);
    assert.equal(matches.length, 1); const n = matches[0];
    inventory.push({ name, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1, sha256: hash(n.getText(ast)), text: n.getText(ast) });
    return n.getText(ast);
  });
  const src = "import * as fs from 'node:fs'; export class FrozenLocal {\n" + members.join('\n') + '\n}';
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: m, exports: m.exports, require: id => { assert.equal(id, 'node:fs'); return fs; } }, { filename: file });
  original = m.exports.FrozenLocal;
  proof('local-path-probes-frozen-extraction', { baseline, file, fileSha256: hash(text), inventory, dependencies: ['node:fs'], boundary: 'Exactly three unchanged AST members; two original method entries. Current uses real compiled production class. No source/export/executeGit/rebase or status credit.' });
  return original;
}
const versions = () => [['frozen', frozen()], ['current', NativeRepositoryConnection]];
async function mocked(run, callback) {
  const before = fs.promises.lstat; const calls = [];
  fs.promises.lstat = async p => { calls.push(p); return run(p, calls.length - 1); };
  try { return await callback(calls); } finally { fs.promises.lstat = before; }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const err = (code, message = code) => Object.assign(new Error(message), { code });

test('P0 local command frozen and current refuse shell execution without filesystem or process effects', async () => {
  const rows = [], directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-b52-command-'));
  try {
    const sentinel = path.join(directory, 'executed');
    for (const [version, K] of versions()) for (const aborted of [false, true]) {
      const c = new AbortController(); if (aborted) c.abort(err('ENOENT', 'cancelled'));
      const connection = new K(c.signal);
      for (const input of [`touch '${sentinel}'`, 'echo x; exit 0', '', undefined]) {
        await mocked(() => { throw Error('unexpected lstat'); }, async calls => {
          await assert.rejects(connection.execCommand(input, directory, c.signal, { stdin: Buffer.from('payload') }), e => e.message === '本地仓库仅支持结构化 Git 命令。');
          assert.deepEqual(calls, []);
        });
        assert(!fs.existsSync(sentinel)); rows.push({ version, aborted, input: input ?? null, message: '本地仓库仅支持结构化 Git 命令。', sentinelAbsent: true });
      }
      await connection.close?.();
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  proof('local-path-probes-command', { rows, boundary: 'Local shell entrance always refuses, including cancelled lifetime; no arbitrary shell publicly exposed.' });
});

test('P0 local path frozen and current preserve exact lstat inputs empty sets symlinks and errors', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    for (const [label, paths, present] of [
      ['empty', [], []], ['all missing', ['/a', '/b'], []], ['one present', ['/a', '/b'], ['/b']],
      ['duplicate paths', ['/a', '/a'], ['/a']], ['literal names', ["/中 '\"$()\n[*]", 'C:/a\\b', '//host/share'], ['//host/share']],
    ]) await mocked(async p => { if (!present.includes(p)) throw err('ENOENT'); return { isFile: () => false }; }, async calls => {
      const c = new K(); assert.equal(await c.hasAnyPath(paths), !!present.length); assert.deepEqual(calls, paths);
      rows.push({ version, label, input: paths, calls: [...calls], expected: !!present.length }); await c.close?.();
    });
    for (const code of ['EACCES', 'EIO', 'ENOTDIR', 2, 'ERR_INVALID_ARG_VALUE']) {
      const reason = err(code);
      await mocked(async p => { if (p === '/bad') throw reason; return {}; }, async calls => {
        const c = new K(); await assert.rejects(c.hasAnyPath(['/yes', '/bad']), e => e === reason); await turn();
        assert.deepEqual(calls, ['/yes', '/bad']); rows.push({ version, label: 'error wins over present', code, identity: true, calls: [...calls] }); await c.close?.();
      });
    }
    for (const paths of [[], ['/a']]) {
      const c = new AbortController(), reason = err('ENOENT', 'preabort'); c.abort(reason);
      await mocked(() => { throw Error('unexpected'); }, async calls => {
        const connection = new K(c.signal); await assert.rejects(connection.hasAnyPath(paths), e => e === reason); assert.deepEqual(calls, []);
        rows.push({ version, label: 'preabort including empty', input: paths, identity: true, calls: [] }); await connection.close?.();
      });
    }
  }
  proof('local-path-probes-matrix', { rows, boundary: 'ENOENT string only maps to false. Directories/symlinks count as present; numeric SSH code 2 is an error for local fs. Concurrent non-cancelled errors preserve identity.' });
});

test('P0 local path cancellation retains reason drains in flight probes and connection close waits', async () => {
  const rows = [];
  for (const [version, K] of versions()) for (const outcome of ['present', 'missing', 'error']) {
    const c = new AbortController(), reason = err('ENOENT', 'cancel in flight'), io = deferred();
    await mocked(() => io.promise, async calls => {
      const connection = new K(c.signal), operation = connection.hasAnyPath(['/one']);
      const settled = operation.then(value => ({ value }), error => ({ error }));
      assert.deepEqual(calls, ['/one']); c.abort(reason);
      if (outcome === 'error') io.reject(err('EACCES')); else if (outcome === 'missing') io.reject(err('ENOENT')); else io.resolve({});
      const result = await settled;
      if (version === 'current') assert.equal(result.error, reason);
      else if (outcome === 'error') assert.equal(result.error.code, 'EACCES'); else assert.equal(result.value, outcome === 'present');
      rows.push({ version, outcome, cancelled: result.error === reason, value: result.value, errorCode: result.error?.code, calls: [...calls] });
      await connection.close?.();
    });
  }
  const c = new NativeRepositoryConnection(), first = deferred(), second = deferred(), failure = err('EIO', 'first probe failure');
  await mocked((_p, i) => i === 0 ? first.promise : second.promise, async calls => {
    let operationDone = false, closeDone = false;
    const operation = c.hasAnyPath(['/one', '/two']).then(() => { operationDone = true; }, e => { operationDone = true; throw e; });
    const observed = operation.catch(e => e); first.reject(failure); await turn(); assert.equal(operationDone, false);
    const close = c.close().then(() => { closeDone = true; }); await turn(); assert.equal(closeDone, false);
    second.resolve({}); assert.equal(await observed, c.signal.reason); await close;
    assert(operationDone && closeDone); assert.deepEqual(calls, ['/one','/two']);
    rows.push({ version: 'current', outcome: 'close during pending sibling after error', calls: [...calls], operationDrained: true, closeWaited: true, exactCancellation: true });
  });
  // Without cancellation, drain then return the original error object.
  await mocked((_p, i) => i === 0 ? Promise.reject(failure) : turn().then(() => ({})), async () => {
    const connection = new NativeRepositoryConnection(); await assert.rejects(connection.hasAnyPath(['/a','/b']), e => e === failure); await connection.close();
  });
  proof('local-path-probes-cancellation', { rows, boundary: 'Intentional frozen/current divergence: current checks cancellation after all probes settle and owns their lifetime. Waiting is cooperative with filesystem completion; no immediate kernel lstat cancellation, arbitrary SSH or process-tree claim.' });
});
function snapshot(directory) {
  const files = {}, modes = {}, links = {};
  function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = path.relative(directory, p); modes[r] = fs.lstatSync(p).mode; if (e.isSymbolicLink()) links[r] = fs.readlinkSync(p); else if (e.isDirectory()) walk(p); else if (e.isFile()) files[r] = hash(fs.readFileSync(p)); } }
  walk(directory); return { files, modes, links };
}

test('P0 local path real native probes preserve byte mode link roots and rebase consumer routing', async t => {
  const f = createRepository(), other = createRepository(); t.after(f.close); t.after(other.close);
  const odd = "中 '\"$()\n[*]", file = path.join(f.repo, odd), dir = path.join(f.repo,'directory'), dangling = path.join(f.repo,'dangling');
  fs.writeFileSync(file, Buffer.from([0,255,10])); fs.mkdirSync(dir); fs.symlinkSync('absent-target', dangling);
  const before = snapshot(f.root), otherBefore = snapshot(other.root), rows = [];
  for (const [version, K] of versions()) {
    const connection = new K();
    for (const [label, input, expected] of [['empty',[],false],['missing',[path.join(f.repo,'missing')],false],['file',[file],true],['directory',[dir],true],['dangling link',[dangling],true],['mix',[path.join(other.repo,'missing'),file],true],['other root own path',[path.join(other.repo,'tracked.txt')],true]]) {
      assert.equal(await connection.hasAnyPath(input), expected); rows.push({ version, label, input, expected });
    }
    await assert.rejects(connection.hasAnyPath([file+'/child']), e => e.code === 'ENOTDIR');
    await connection.close?.();
  }
  const connection = new NativeRepositoryConnection(), calls = [], probe = connection.hasAnyPath.bind(connection);
  connection.hasAnyPath = async paths => { calls.push([...paths]); return probe(paths); };
  const state = await new InteractiveRebase(connection).state(f.repo); assert.deepEqual(state, { active: false, managed: false, inProgress: false, conflicts: [] });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], ['rebase-merge','rebase-apply','alune-interactive-rebase'].map(n => path.join(fs.realpathSync.native(f.repo),'.git',n)));
  await connection.close(); assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(other.root), otherBefore);
  proof('local-path-probes-real-native', { rows, rebase: { calls, state }, before, after: snapshot(f.root), otherBefore, otherAfter: snapshot(other.root), boundary: 'Private local helper intentionally accepts absolute paths; ownership enforced by consumer. Two isolated roots, real disk, file/directory/dangling lstat semantics. No SSH contract selected.' });
});

test('P0 local path actual SDK status isolates two Agents strict params cancellation and helper absence', async t => {
  const { spawnAgent } = require('@alune/agent-client/node');
  const f = createRepository(), other = createRepository(); t.after(f.close); t.after(other.close);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-b52-sdk-')); t.after(() => fs.rmSync(state,{recursive:true,force:true}));
  const agents = ['a','b'].map(n => spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(state,n)],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'}}));
  t.after(() => Promise.all(agents.map(a => a.close())));
  try {
    const [a,b] = agents, initA = await a.client.initialize(), initB = await b.client.initialize(); assert.notEqual(initA.agentId, initB.agentId);
    const own = (await a.client.registerRepository(f.repo)).resource, foreign = (await b.client.registerRepository(other.repo)).resource;
    const before = snapshot(f.root), otherBefore = snapshot(other.root);
    const status = await a.client.readRepository(own,'status',{}); assert.equal(status.worktreeKind,'main'); assert.equal(status.unborn,undefined); assert.equal(status.branch,f.git('symbolic-ref','--short','HEAD').trim());
    const otherStatus = await b.client.readRepository(foreign,'status',{}); assert.equal(otherStatus.worktreeKind,'main');
    for (const [client,resource] of [[a.client,foreign],[b.client,own]]) await assert.rejects(client.readRepository(resource,'status',{}), e => e.kind === 'not-found');
    await assert.rejects(a.client.request('repositories.read',{resource:own,kind:'status',params:{path:other.repo}}), e => e.kind === 'invalid-params');
    for (const method of ['hasAnyPath','local.hasAnyPath','execCommand','local.execCommand']) await assert.rejects(a.client.request(method,{}), e => e.kind === 'unknown-method');
    const c = new AbortController(); c.abort(); await assert.rejects(a.client.readRepository(own,'status',{},{signal:c.signal}), e => e.kind === 'cancelled');
    assert.deepEqual(snapshot(f.root),before); assert.deepEqual(snapshot(other.root),otherBefore);
    proof('local-path-probes-sdk',{agentIds:[initA.agentId,initB.agentId],own,foreign,status,otherStatus,foreignAgentsRejected:true,strictParams:true,helperRpcAbsent:true,preabort:true,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),boundary:'Two actual stdio Agents and native status consumers, status main classification uses private hasAnyPath. Current SDK DTO and ownership assertion, not full frozen SDK equality. No helper events/writes; independent companions cover write unknown/no replay.'});
  } finally { await Promise.all(agents.map(a => a.close())); }
});
