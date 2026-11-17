const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { RepositoryReader } = require('../dist/modules/repositories/reads');
const { createRepository } = require('./helpers/local-repository.cjs');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
const plain = v => JSON.parse(JSON.stringify(v));
const proof = (name, value) => { if (process.env.P0_WORKTREE_IDENTITY_PROOF_DIR) fs.writeFileSync(path.join(process.env.P0_WORKTREE_IDENTITY_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', {flag:'wx'}); };
let method;
function readFrozen(file) {
  const source = fs.readFileSync(path.join(process.env.P0_WORKTREE_IDENTITY_FROZEN, file), 'utf8');
  assert.equal(source, execFileSync('git', ['show', baseline + ':' + file], {cwd:root,encoding:'utf8'}));
  return source;
}
function frozen(Worktrees, timers = {setTimeout, clearTimeout}) {
  if (!method) {
    const file = 'apps/server/src/repository/repository.service.ts', source = readFrozen(file);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'RepositoryService');
    const nodes = klass.members.filter(n => n.name?.getText(ast) === 'readWorktreeKind');
    assert.equal(nodes.length, 1); method = nodes[0].getText(ast);
    proof('worktree-identity-frozen-extraction', {baseline, file, fileSha256:hash(source), inventory:[{name:'readWorktreeKind',line:ast.getLineAndCharacterOfPosition(nodes[0].getStart(ast)).line+1,text:method,sha256:hash(method)}],boundary:'One exact unchanged AST method; injected GitWorktrees dependency and optional controlled timers explicitly identified per test. Real Git test loads full frozen Worktrees and its four verified dependencies. Current uses compiled RepositoryReader.status.'});
  }
  const m = {exports:{}};
  vm.runInNewContext(ts.transpileModule('export class Frozen {\n'+method+'\n}', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:m,exports:m.exports,GitWorktrees:Worktrees,AbortSignal,AbortController,...timers});
  return new m.exports.Frozen();
}
function frozenWorktrees() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts', source = readFrozen(file), m = {exports:{}};
    cache.set(name,m.exports);
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Buffer,process,AbortSignal,require:id=>{
      if (id === 'util' || id === 'node:path') return require(id);
      assert(['./worktrees','./git-shell','./repository-path','./repository-transport'].includes(id), 'Unexpected runtime frozen dependency '+id);
      return load(id.slice(2));
    }});
    return m.exports;
  }
  return load('worktrees').GitWorktrees;
}
const baseStatus = () => ({branch:'main',files:[],ahead:0,behind:0});
function readerFixture({mode='main',signal,hasAnyPath=true,directoryError,statusError}={}) {
  const trace = [];
  const connection = {
    signal,
    gitDirectory: async p => { trace.push({kind:'gitDirectory',path:p}); if(directoryError)throw directoryError;return '/repo/.git'; },
    hasAnyPath: async paths => {trace.push({kind:'hasAnyPath',paths});return hasAnyPath;},
    withSftp: async op => op({readdir:(_p,cb)=>cb(null,[])}),
    execGit: async (p,args,s,options) => {
      trace.push({kind:'git',path:p,args:[...args],strictUtf8:options?.strictUtf8,maxOutputBytes:options?.maxOutputBytes});
      s?.throwIfAborted();
      assert.equal(p,'/repo');assert.equal(args[0],'rev-parse');assert.equal(args[1],'--path-format=absolute');
      if (mode === 'error') throw Error('optional identity unavailable');
      if (mode === 'nonzero') return {exitCode:2,stdout:'',stderr:'not a repository'};
      if (mode === 'stall') return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));
      return {exitCode:0,stdout:args[2] === '--git-common-dir' || mode === 'main' ? '/repo/.git\n' : '/repo/.git/worktrees/linked\n',stderr:''};
    },
  };
  const reader = new RepositoryReader(connection);
  reader.git.status = async (p,s,foreground) => { assert.equal(p,'/repo');assert.equal(s,signal);assert.equal(foreground,false);if(statusError)throw statusError;return baseStatus(); };
  return {reader,trace};
}
function snapshot(directory) {
  const files={},modes={},links={};
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=path.relative(directory,f);modes[r]=fs.lstatSync(f).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(f);else if(e.isDirectory())walk(f);else if(e.isFile())files[r]=hash(fs.readFileSync(f));}}
  walk(directory);return {files,modes,links};
}
const environment = {GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'};

test('P0 optional worktree frozen method preserves success error suppression timer cleanup and parent boundary', async () => {
  const rows=[];
  for(const mode of ['main','linked','error','preabort','timeout']) {
    const timers=[],parent=new AbortController(),reason=Error('parent cancelled');if(mode==='preabort')parent.abort(reason);
    let observed;
    class Worktrees { constructor(c){assert.equal(c.marker,true);} kind(p,s){assert.equal(p,"/repo/中 '\n");observed=s;if(mode==='timeout')return new Promise(()=>{});if(mode==='error')return Promise.reject(Error('identity failed'));if(s.aborted)return Promise.reject(s.reason);return Promise.resolve(mode);} }
    const service=frozen(Worktrees,{setTimeout:(fn,ms)=>{const timer={fn,ms,cleared:false};timers.push(timer);return timer;},clearTimeout:t=>{t.cleared=true;}});
    const pending=service.readWorktreeKind({path:"/repo/中 '\n"},{marker:true},parent.signal);
    assert.equal(timers.length,1);assert.equal(timers[0].ms,1500);
    if(mode==='timeout')timers[0].fn();
    const result=await pending;
    assert.equal(result,mode==='main'||mode==='linked'?mode:undefined);
    assert.equal(timers[0].cleared,true);assert.equal(observed.aborted,true);
    if(mode==='preabort')assert.equal(observed.reason,reason);
    rows.push({mode,result:result??null,timerMs:timers[0].ms,timerCleared:true,childAborted:true,parentAborted:parent.signal.aborted});
  }
  proof('worktree-identity-frozen-policy',{rows,boundary:'Exact frozen method under controlled timer seam: configured 1500ms, all completion cleanup, errors and parent abort swallowed as optional identity. No real wall-clock claim for this matrix.'});
});

test('P0 optional worktree current status preserves identity fallback fast path and primary errors', async () => {
  const rows=[];
  for(const mode of ['main','linked','error','nonzero']) {
    const {reader,trace}=readerFixture({mode}),status=await reader.status('/repo');
    assert.deepEqual(status,{...baseStatus(),...(['main','linked'].includes(mode)?{worktreeKind:mode}:{})});
    const calls=trace.filter(e=>e.kind==='git');assert.equal(calls.length,2);
    assert.deepEqual(calls.map(e=>e.args[2]).sort(),['--git-common-dir','--git-dir']);
    for(const c of calls){assert.equal(c.strictUtf8,true);assert.equal(c.maxOutputBytes,1048576);}
    rows.push({mode,status,trace});
  }
  for(const options of [{hasAnyPath:false},{directoryError:Error('optional git directory missing')}]) {
    const {reader,trace}=readerFixture(options),status=await reader.status('/repo');
    assert.deepEqual(status,{...baseStatus(),...(options.hasAnyPath===false?{worktreeKind:'main'}:{})});assert.equal(trace.filter(e=>e.kind==='git').length,0);
    rows.push({mode:options.directoryError?'git-directory-error':'commondir-absent-fast-path',status,trace});
  }
  const reason=Error('primary status failed'),{reader}=readerFixture({statusError:reason});await assert.rejects(reader.status('/repo'),e=>e===reason);
  rows.push({mode:'primary-error',preservedIdentity:true});
  proof('worktree-identity-current-policy',{rows,boundary:'Compiled current status with controlled transport and primary status seam. Optional failures do not spoil successful status, missing commondir avoids identity subprocesses, primary status errors retain identity. No helper RPC.'});
});

test('P0 optional worktree real timeout is bounded and current cancellation propagates', async () => {
  const keepAlive=setTimeout(()=>{},8000),rows=[];
  try {
    for(const version of ['frozen','current']) {
      const parent=new AbortController();let child;
      const start=performance.now();
      let result;
      if(version==='frozen') {
        class Worktrees{kind(_p,s){child=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));}}
        result=await frozen(Worktrees).readWorktreeKind({path:'/repo'},{},parent.signal);
      } else result=await readerFixture({mode:'stall'}).reader.status('/repo');
      const elapsedMs=performance.now()-start;assert(elapsedMs>=1400 && elapsedMs<6000);
      if(version==='frozen'){assert.equal(result,undefined);assert(child.aborted);}else assert.deepEqual(result,baseStatus());
      rows.push({version,mode:'actual-timeout',elapsedMs,result:result??null});
    }
    for(const preabort of [true,false]) {
      const controller=new AbortController(),reason=Error('current request cancelled');if(preabort)controller.abort(reason);
      const {reader,trace}=readerFixture({mode:'stall',signal:controller.signal});const pending=reader.status('/repo');
      if(!preabort) { await new Promise(resolve=>setImmediate(resolve));assert.equal(trace.filter(e=>e.kind==='git').length,2);controller.abort(reason); }
      await assert.rejects(pending,e=>e===reason);rows.push({version:'current',mode:preabort?'preabort':'inflight-cancel',errorIdentity:true});
    }
  } finally {clearTimeout(keepAlive);}
  proof('worktree-identity-timeouts',{rows,boundary:'Real 1500ms timers on darwin with cooperative pending identity reads. Frozen parent abort degrades to undefined; current request cancellation rejects status with original error identity, an intentional Agent contract. Noncooperative transport and stalled gitDirectory are not bounded by this optional timer.'});
});

test('P0 optional worktree real native frozen and current classify main linked detached aliases and two roots without writes', async t => {
  const fixtures=[createRepository(),createRepository()];fixtures.forEach(f=>t.after(f.close));
  const OriginalWorktrees=frozenWorktrees(),rows=[];
  for(const f of fixtures) {
    const linked=path.join(f.root,"linked 中 '\nend"),detached=path.join(f.root,'detached');f.git('worktree','add','-qb','identity/linked',linked);f.git('worktree','add','-q','--detach',detached);
    const alias=path.join(f.root,'linked-alias');fs.symlinkSync(linked,alias,'dir');const nested=path.join(linked,'sub');fs.mkdirSync(nested);
    const connection=new NativeRepositoryConnection();t.after(()=>connection.close());
    const before=snapshot(f.root);
    for(const [directory,expected] of [[f.repo,'main'],[linked,'linked'],[detached,'linked'],[alias,'linked'],[nested,'linked']]) {
      const parent=new AbortController();const original=await frozen(OriginalWorktrees).readWorktreeKind({path:directory},connection,parent.signal);
      const current=await new RepositoryReader(connection).status(directory);
      const gitDir=execFileSync('git',['-C',directory,'rev-parse','--path-format=absolute','--git-dir'],{encoding:'utf8'}).replace(/\r?\n$/,'');
      const common=execFileSync('git',['-C',directory,'rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8'}).replace(/\r?\n$/,'');
      assert.equal(gitDir===common?'main':'linked',expected);assert.equal(original,expected);assert.equal(current.worktreeKind,expected);
      rows.push({root:f.root,directory,expected,original,current:current.worktreeKind,gitDir,common});
    }
    const after=snapshot(f.root);assert.deepEqual(after,before);rows.push({root:f.root,before,after,unchanged:true});
  }
  proof('worktree-identity-native',{rows,boundary:'Two isolated actual native Git roots, main/linked/detached/symlink/subdirectory and literal newline paths. Frozen exact service method uses full frozen Worktrees dependency chain over current native transport; current compiled reader. Byte/mode/link snapshots unchanged. No original server or SSH/Windows execution claim.'});
});

test('P0 optional worktree actual SDK exposes correct identity and enforces owning resources strict params and cancellation', async t => {
  const {spawnAgent}=require('@alune/agent-client/node');const fixtures=[createRepository(),createRepository()];fixtures.forEach(f=>t.after(f.close));
  const linked=path.join(fixtures[0].root,'linked');fixtures[0].git('worktree','add','-qb','sdk/linked',linked);
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b54-sdk-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
  const agents=['a','b'].map(n=>spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(state,n)],{env:{...process.env,...environment}}));
  try {
    const [a,b]=agents,identities=await Promise.all(agents.map(a=>a.client.initialize()));assert.notEqual(identities[0].agentId,identities[1].agentId);
    const main=(await a.client.registerRepository(fixtures[0].repo)).resource,link=(await a.client.registerRepository(linked)).resource,foreign=(await b.client.registerRepository(fixtures[1].repo)).resource;
    const before=fixtures.map(f=>snapshot(f.root)),rows=[];
    for(const [client,resource,expected] of [[a.client,main,'main'],[a.client,link,'linked'],[b.client,foreign,'main']]){const result=await client.readRepository(resource,'status',{});assert.equal(result.worktreeKind,expected);rows.push({resource,expected,result:result.worktreeKind});}
    for(const [client,resource] of [[a.client,foreign],[b.client,main],[b.client,link]])await assert.rejects(client.readRepository(resource,'status',{}),e=>e.kind==='not-found');
    await assert.rejects(a.client.request('repositories.read',{resource:main,kind:'status',params:{path:fixtures[1].repo}}),e=>e.kind==='invalid-params');
    for(const method of ['readWorktreeKind','repositories.readWorktreeKind'])await assert.rejects(a.client.request(method,{resource:main}),e=>e.kind==='unknown-method');
    const controller=new AbortController();controller.abort();await assert.rejects(a.client.readRepository(link,'status',{},{signal:controller.signal}),e=>e.kind==='cancelled');
    const after=fixtures.map(f=>snapshot(f.root));assert.deepEqual(after,before);
    proof('worktree-identity-sdk',{agentIds:identities.map(i=>i.agentId),rows,foreignRejections:3,strictParams:true,helperRpcAbsent:true,preabort:true,before,after,boundary:'Actual Agent processes via SDK/stdio, resource ownership and strict query schema. Preabort only at SDK; inflight cancellation proven at direct current reader above. Independent write/unknown/no-replay companions are separate regressions, not helper mutations.'});
  } finally {await Promise.all(agents.map(a=>a.close()));}
});
