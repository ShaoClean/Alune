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
const { GitLfs } = require('../dist/modules/git/lfs');
const { DiffImages } = require('../dist/modules/git/diff-images');
const root = path.resolve(__dirname, '../../..'), baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
const result = (stdout = '', exitCode = 0, stderr = '') => ({ stdout, exitCode, stderr });
const bytes = Buffer.from([0, 255, 128, 10, 13, 42]);
const pointer = b => ({ oid: hash(b), size: b.length });
function proof(name, value) { if (process.env.P0_LFS_OBJECT_PROOF_DIR) fs.writeFileSync(path.join(process.env.P0_LFS_OBJECT_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
let original;
function frozen() {
  if (original) return original;
  const dependencies = [], inventory = [], modules = { 'node:crypto': require('node:crypto'), 'node:util': require('node:util'), util: require('node:util'), 'node:path': require('node:path') };
  const source = file => { const text = fs.readFileSync(path.join(process.env.P0_LFS_OBJECT_FROZEN, file), 'utf8'); assert.equal(text, execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' })); return text; };
  const execute = (text, file) => { const m = { exports: {} }; vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: m, exports: m.exports, Buffer, Error, AbortController, AbortSignal, require: id => { assert(Object.hasOwn(modules, id), id); return modules[id]; } }, { filename: file }); return m.exports; };
  for (const [id, file] of [['./git-shell', 'packages/ssh-client/src/git-shell.ts'], ['./repository-transport', 'packages/ssh-client/src/repository-transport.ts'], ['./repository-path', 'packages/ssh-client/src/repository-path.ts'], ['./sftp-file', 'packages/ssh-client/src/sftp-file.ts']]) { const text = source(file); modules[id] = execute(text, file); dependencies.push({ file, sha256: hash(text) }); }
  const file = 'packages/ssh-client/src/lfs.ts', text = source(file), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'GitLfs');
  const methods = ['constructor', 'readObject'].map(name => { const nodes = klass.members.filter(n => name === 'constructor' ? ts.isConstructorDeclaration(n) : n.name?.getText(ast) === name); assert.equal(nodes.length, 1); const n = nodes[0]; inventory.push({ file, name: 'GitLfs.' + name, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1, sha256: hash(n.getText(ast)) }); return n.getText(ast); });
  original = execute("import {createHash} from 'node:crypto'; import {promisify} from 'node:util'; import {joinRepositoryPath} from './repository-path'; import {runGit, type RepositoryTransport} from './repository-transport'; import {readSftpChunks} from './sftp-file';\nexport class FrozenLfsObject {\n" + methods.join('\n') + '\n}', file).FrozenLfsObject;
  proof('lfs-object-frozen-extraction', { baseline, inventory, dependencies, boundary: 'Two original AST members unchanged; four complete frozen dependency modules. Only original readObject receives credit; current intentionally propagates cancellation.' });
  return original;
}
const versions = () => [['frozen', frozen()], ['current', GitLfs]];
function scripted(o = {}) {
  const content = o.bytes ?? bytes, p = o.pointer ?? pointer(content), calls = [], controller = new AbortController(), reason = Object.assign(new Error('identity ' + (o.failureAt ?? o.cancelAt ?? 'reason')), o.code === undefined ? {} : { code: o.code });
  let opened = 0, closed = 0, readBytes = 0;
  const boundary = (where, cb) => { if (o.cancelAt === where) controller.abort(reason); if (o.failureAt === where) { cb(reason); return true; } return false; };
  const sftp = {
    lstat(target, cb) { calls.push({ type: 'lstat', target }); if (!boundary('lstat', cb)) cb(null, { size: o.statSize ?? p.size, isFile: () => !o.kind || o.kind === 'file' }); },
    open(target, flags, cb) { calls.push({ type: 'open', target, flags }); assert.equal(flags, 'r'); if (!boundary('open', cb)) { opened++; cb(null, Buffer.from('handle')); } },
    read(handle, buffer, offset, length, position, cb) { assert.equal(handle.toString(), 'handle'); assert.equal(offset, 0); assert.equal(length, 65536); calls.push({ type: 'read', position, length }); if (boundary('read', cb)) return; const n = Math.min(length, content.length - position); content.copy(buffer, 0, position, position + n); readBytes += n; if (o.cancelAt === 'chunk' && n || o.cancelAt === 'eof' && !n) controller.abort(reason); cb(null, n, buffer); },
    close(handle, cb) { calls.push({ type: 'close' }); closed++; if (!boundary('close', cb)) cb(null); },
  };
  const connection = { signal: o.noSignal ? undefined : controller.signal,
    async execGit(repo, argv, signal) { const args = Array.from(argv), phase = args.includes('contentlocation') ? 'location' : args[0] === 'config' ? 'config' : 'common'; calls.push({ type: 'git', repo, args }); if (o.cancelAt === phase) controller.abort(reason); if (o.failureAt === phase) { calls.at(-1).error = reason.message; throw reason; } const output = o[phase] ?? (phase === 'location' ? result('/cache/object\n') : phase === 'config' ? result('', 1) : result('.git\n')); calls.at(-1).result = output; return output; },
    withSftp(fn) { calls.push({ type: 'withSftp' }); if (o.cancelAt === 'withSftp') controller.abort(reason); if (o.failureAt === 'withSftp') return Promise.reject(reason); return fn(sftp); },
  };
  return { calls, controller, reason, connection, p, content, run: (K, signal) => new K(connection).readObject(o.repo ?? '/repo', p, o.limit ?? 1024 * 1024, signal), counts: () => ({ opened, closed, readBytes }) };
}
const errorMessage = message => e => e.message === message;

test('P0 LFS object frozen and current preserve location fallback paths bounded bytes digest errors and handle closure', async () => {
  const rows = [];
  for (const [version, K] of versions()) {
    const run = async (label, options = {}, message, absent = false) => {
      const f = scripted(options); let output;
      if (message) await assert.rejects(f.run(K), errorMessage(message));
      else if (options.failureAt && !absent) await assert.rejects(f.run(K), e => e === f.reason);
      else { output = await f.run(K); if (absent) assert.equal(output, null); else assert.deepEqual(output, f.content); }
      assert.equal(f.counts().opened, f.counts().closed);
      if (options.expectedTarget) assert.equal(f.calls.find(c => c.type === 'lstat').target, options.expectedTarget);
      if (options.statSize !== undefined && options.statSize !== f.p.size || options.kind && options.kind !== 'file' || f.p.size > (options.limit ?? 1024 * 1024)) assert.equal(f.counts().opened, 0);
      const git = f.calls.filter(c => c.type === 'git');
      assert(git.every(c => ['contentlocation','config','rev-parse'].some(x => c.args.includes(x))));
      if (git.length) assert.deepEqual(git[0].args, ['--no-literal-pathspecs', 'lfs', 'contentlocation', f.p.oid]);
      rows.push({ version, label, pointer: f.p, input: {size:f.content.length,sha256:hash(f.content),base64:f.content.toString('base64')}, limit: options.limit ?? 1024 * 1024, expectedTarget: options.expectedTarget, calls: f.calls, ...f.counts(), output: output === null ? null : output ? { size: output.length, sha256: hash(output) } : undefined, message, absent, errorIdentity: !!options.failureAt && !message && !absent });
    };
    await run('binary direct absolute', { expectedTarget: '/cache/object' });
    await run('empty verified object', { bytes: Buffer.alloc(0) });
    await run('exact preview limit', { bytes: Buffer.alloc(131072, 255), limit: 131072 });
    await run('relative contentlocation special path', { location: result("缓存/中文 '\"$()\\[*].bin\n"), expectedTarget: "/repo/缓存/中文 '\"$()\\[*].bin" });
    await run('Windows absolute contentlocation', { location: result('D:/cache/object\r\n'), expectedTarget: 'D:/cache/object' });
    for (const [label, repo, config, common, base] of [
      ['default relative common','/repo','', '.git', '/repo/.git/lfs'],
      ['relative custom storage','/repo','../cache dir', '.git', '/repo/cache dir'],
      ['absolute custom storage','/repo','/custom cache', '.git', '/custom cache'],
      ['absolute linked common','/linked','', '/main/.git', '/main/.git/lfs'],
      ['Windows relative storage','C:/Repo','cache', 'D:/Main/.git', 'D:/Main/.git/cache'],
      ['Windows absolute storage','C:/Repo','E:\\LFS', '.git', 'E:\\LFS'],
      ['UNC common directory','//host/share/repo','', '//host/share/main/.git', '//host/share/main/.git/lfs'],
    ]) { const p = pointer(bytes); await run(label, { repo, location: result('', 1, 'not installed'), config: result(config + '\n', config ? 0 : 1), common: result(common + '\n'), expectedTarget: base + '/objects/' + p.oid.slice(0,2) + '/' + p.oid.slice(2,4) + '/' + p.oid }); }
    await run('empty successful location falls back', { location: result(' \r\n'), expectedTarget: '/repo/.git/lfs/objects/' + pointer(bytes).oid.slice(0,2) + '/' + pointer(bytes).oid.slice(2,4) + '/' + pointer(bytes).oid });
    await run('oversize pointer before commands', { pointer: { ...pointer(bytes), size: 1048577 } }, 'LFS 文件超出预览限制（1 MiB）。');
    for (const kind of ['directory','symlink','socket']) await run('reject leaf ' + kind, { kind }, 'LFS 对象大小不匹配或不是普通文件，请重新拉取。');
    await run('stat size mismatch', { statSize: bytes.length + 1 }, 'LFS 对象大小不匹配或不是普通文件，请重新拉取。');
    await run('stream grows beyond pointer', { bytes: Buffer.alloc(131073), pointer: pointer(Buffer.alloc(131072)), limit: 200000 }, 'LFS 对象超出预览限制。');
    await run('stream grows beyond limit', { bytes: Buffer.alloc(131073), pointer: pointer(Buffer.alloc(131072)), limit: 131072 }, 'LFS 对象超出预览限制。');
    await run('stream shrinks', { pointer: pointer(Buffer.alloc(bytes.length + 1)) }, 'LFS 对象校验失败，请重新拉取。');
    await run('same size wrong digest', { pointer: pointer(Buffer.alloc(bytes.length)) }, 'LFS 对象校验失败，请重新拉取。');
    for (const phase of ['config','common']) for (const stderr of ['permission denied\n','']) await run(phase + ' nonzero ' + (stderr ? 'stderr' : 'default'), { location: result('', 1), [phase]: result('', 128, stderr) }, stderr || (phase === 'config' ? '无法读取 LFS 存储配置。' : '无法定位 LFS 缓存。'));
    for (const failureAt of ['location','config','common','withSftp','lstat','open','read','close']) await run('identity ' + failureAt, { failureAt, ...['config','common'].includes(failureAt) ? { location: result('',1) } : {} });
    for (const code of ['ENOENT',2,'EACCES',3]) for (const failureAt of ['lstat','open','read','close']) await run('filesystem ' + code + ' ' + failureAt, { code, failureAt }, undefined, ['ENOENT',2].includes(code));
  }
  proof('lfs-object-matrix', { rows, boundary: 'Original/current controlled SFTP and structured Git; internal pointer is already validated by parseLfsPointer. Configured absolute/outside storage intentionally supported. Missing mapping only inside SFTP callback; command/session errors retain identity. Close attempted before success or failure.' });
});

test('P0 LFS object preserves cancellation identity at Git filesystem chunk EOF and close boundaries', async () => {
  const rows = [];
  for (const [version, K] of versions()) for (const cancelAt of ['location','config','common','withSftp','lstat','open','chunk','eof','close']) {
    const f = scripted({ bytes: Buffer.alloc(131072,42), cancelAt, ...['config','common'].includes(cancelAt) ? { location: result('',1) } : {} });
    if (version === 'current' || cancelAt === 'config') await assert.rejects(f.run(K), e => e === f.reason);
    else assert.deepEqual(await f.run(K), f.content);
    assert.equal(f.counts().opened, f.counts().closed);
    if (version === 'current' && ['location','config','common','withSftp','lstat'].includes(cancelAt)) assert.equal(f.counts().opened,0);
    if (version === 'current' && ['open','chunk'].includes(cancelAt)) assert(f.counts().readBytes <= 65536);
    rows.push({ version, cancelAt, outcome: version === 'current' || cancelAt === 'config' ? 'exact cancellation reason' : 'original returns bytes despite cancellation', calls: f.calls, ...f.counts() });
  }
  for (const origin of ['caller','connection']) for (const phase of ['preabort','chunk','missing']) {
    const caller = new AbortController(), f = scripted({ bytes: Buffer.alloc(131072,42), ...(phase === 'missing' ? { failureAt: 'lstat', code: 'ENOENT' } : {}) }), reason = Object.assign(new Error(origin + ' cancellation'), { code:'ENOENT' });
    const c = origin === 'caller' ? caller : f.controller;
    if (phase === 'preabort') c.abort(reason);
    else { const old = f.connection.withSftp; f.connection.withSftp = fn => old(sftp => { const method = phase === 'chunk' ? 'read' : 'lstat', base = sftp[method]; sftp[method] = (...args) => { c.abort(reason); base(...args); }; return fn(sftp); }); }
    await assert.rejects(f.run(GitLfs, caller.signal), e => e === reason);
    assert.equal(f.counts().opened, f.counts().closed);
    if (phase === 'preabort') assert.equal(f.calls.length,0);
    if (phase === 'chunk') assert.equal(f.counts().readBytes,65536);
    rows.push({ version:'current', origin, phase, exactReason:true, calls:f.calls, ...f.counts() });
  }
  // The public image helper must forward its caller signal into LFS hydration.
  const c = new AbortController(), f = scripted({ bytes: Buffer.alloc(131072,42) }), reason = new Error('image caller during cache read');
  const image = new DiffImages(f.connection); image.readWorktree = async () => Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:' + f.p.oid + '\nsize ' + f.p.size + '\n');
  const old = f.connection.withSftp; f.connection.withSftp = fn => old(sftp => { const read=sftp.read; sftp.read=(...args)=>{ c.abort(reason); read(...args); }; return fn(sftp); });
  await assert.rejects(image.read('/repo',{file:'image.png',side:'after'},c.signal),e=>e===reason);
  assert.equal(f.counts().opened,1); assert.equal(f.counts().closed,1); assert.equal(f.counts().readBytes,65536);
  rows.push({version:'current',phase:'image consumer forwards caller',exactReason:true,calls:f.calls,...f.counts()});
  proof('lfs-object-cancellation',{rows,boundary:'Current explicitly checks both signal sources after awaited Git/SFTP/chunk/EOF/close and before ENOENT mapping; acknowledges close. Frozen post-command omission retained. No immediate interruption of a callback that never returns or process-tree kill claim.'});
});
function snapshot(directory) { const files={},modes={},links={}; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=path.relative(directory,f);modes[r]=fs.lstatSync(f).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(f);else if(e.isDirectory())walk(f);else if(e.isFile())files[r]=hash(fs.readFileSync(f));}};walk(directory);return{files,modes,links}; }
function cacheObject(base, b) {const p=pointer(b),target=path.join(base,'objects',p.oid.slice(0,2),p.oid.slice(2,4),p.oid);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b);return {p,target};}
async function real(t,ssh) {
  const f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);
  const first=cacheObject(path.join(f.repo,'.git','lfs'),bytes), second=cacheObject(path.join(other.repo,'.git','lfs'),Buffer.from([0,255,43]));
  const custom=path.join(f.root,"缓存 中文 '$()"),customObject=cacheObject(custom,Buffer.alloc(131072,255));
  const customRepo=path.join(f.root,'custom repo');fs.mkdirSync(customRepo);execFileSync('git',['init','-q',customRepo]);execFileSync('git',['-C',customRepo,'config','lfs.storage',custom]);
  const linked=path.join(f.root,'linked worktree');f.git('worktree','add','--detach',linked,'HEAD');
  const relativeRepo=path.join(f.root,'relative repo');fs.mkdirSync(relativeRepo);execFileSync('git',['init','-q',relativeRepo]);execFileSync('git',['-C',relativeRepo,'config','lfs.storage','../relative-cache']);const relative=cacheObject(path.join(relativeRepo,'relative-cache'),Buffer.alloc(0));
  let connection;if(ssh){const server=await startSSHServer();t.after(()=>server.close());connection=new SSHConnection(server.options);connection.on('error',()=>{});await connection.connect();t.after(()=>connection.disconnect());}else{connection=new NativeRepositoryConnection();t.after(()=>connection.close());}
  const before=snapshot(f.root),otherBefore=snapshot(other.root),rows=[];
  for(const[version,K]of versions())for(const[label,repo,p,expected]of[
    ['standard',f.repo,first.p,bytes],['other root same oid missing',other.repo,first.p,null],['other root own object',other.repo,second.p,Buffer.from([0,255,43])],['absolute custom storage',customRepo,customObject.p,Buffer.alloc(131072,255)],['relative storage empty object',relativeRepo,relative.p,Buffer.alloc(0)],['linked common directory',linked,first.p,bytes],['missing object',f.repo,pointer(Buffer.from('absent')),null],
  ]){
    const calls=[];const wrapped={signal:connection.signal,withSftp:fn=>connection.withSftp(fn),execCommand:async(...a)=>{const r=await connection.execCommand(...a);calls.push({command:a[0],...r});return r;},...(connection.execGit?{execGit:async(...a)=>{const r=await connection.execGit(...a);calls.push({repo:a[0],args:a[1],...r});return r;}}:{})};
    const actual=await new K(wrapped).readObject(repo,p,1024*1024);assert.deepEqual(actual,expected);rows.push({version,label,repo,pointer:p,expected:expected===null?null:{size:expected.length,sha256:hash(expected)},actual:actual===null?null:{size:actual.length,sha256:hash(actual)},calls});
  }
  assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);
  proof(ssh?'lfs-object-real-ssh':'lfs-object-real-native',{rows,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),boundary:'Real Git and SFTP/native disk, two independent roots plus linked worktree and configured absolute/relative storage. Read-only, no git lfs fetch/pull/download. SSH is encrypted isolated loopback, not arbitrary remote host.'});
}
test('P0 LFS object real native reads match frozen helper across standard custom and linked worktree caches',async t=>real(t,false));
test('P0 LFS object real SSH reads match frozen helper across standard custom and linked worktree caches',async t=>real(t,true));

test('P0 LFS object actual SDK image consumer isolates resources validates cache and exposes no helper RPC',async t=>{
 const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository(),other=createRepository(),state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b51-sdk-'));t.after(f.close);t.after(other.close);t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
 const p=pointer(bytes),file="目录/中文 '$().png",text='version https://git-lfs.github.com/spec/v1\noid sha256:'+p.oid+'\nsize '+p.size+'\n';f.write(file,text);other.write(file,text);const cached=cacheObject(path.join(f.repo,'.git','lfs'),bytes);
 const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),state],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
 try{const init=await child.client.initialize(),own=(await child.client.registerRepository(f.repo)).resource,second=(await child.client.registerRepository(other.repo)).resource;assert.equal(own.agentId,init.agentId);const before=snapshot(f.root),otherBefore=snapshot(other.root),rows=[];
 const dto=await child.client.readRepository(own,'diffImage',{file,side:'after'});assert.deepEqual(dto,{path:file,side:'after',mediaType:'image/png',byteLength:bytes.length,content:bytes.toString('base64')});rows.push({label:'own cached image',resource:own,dto});
 await assert.rejects(child.client.readRepository(second,'diffImage',{file,side:'after'}),e=>e.kind==='invalid-params'&&e.message==='LFS 图片尚未下载（'+p.size+' 字节，OID '+p.oid+'）。请在仓库所在主机运行 git lfs pull。');rows.push({label:'other root cannot read owning cache',resource:second,missing:true,kind:'invalid-params'});
 for(const resource of[{...own,agentId:randomUUID()},{...own,resourceId:randomUUID()}])await assert.rejects(child.client.readRepository(resource,'diffImage',{file,side:'after'}),e=>e.kind==='not-found');
 await assert.rejects(child.client.request('repositories.read',{resource:own,kind:'diffImage',params:{file,side:'after',path:other.repo}}),e=>e.kind==='invalid-params');
 for(const method of['gitLfs.readObject','readObject','git.execute'])await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');
 const c=new AbortController();c.abort();await assert.rejects(child.client.readRepository(own,'diffImage',{file,side:'after'},{signal:c.signal}),e=>e.kind==='cancelled');
 assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);
 proof('lfs-object-sdk',{rows,own,second,foreignResourceRejected:true,strictParams:true,helperRpcAbsent:true,preabort:true,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),boundary:'Actual current stdio SDK image DTO only; two repositories on one Agent plus random foreign identifiers, not two real Agents or full frozen SDK. No helper write/event contract; companion mutations cover unknown/no replay separately.'});
 }finally{await child.close();}
});
