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
const proof = (name, value) => { if(process.env.P0_WORKTREE_LIST_SERVICE_PROOF_DIR) fs.writeFileSync(path.join(process.env.P0_WORKTREE_LIST_SERVICE_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'}); };
function readFrozen(file) {
  const s = fs.readFileSync(path.join(process.env.P0_WORKTREE_LIST_SERVICE_FROZEN,file),'utf8');
  assert.equal(s,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));return s;
}
let extraction;
function frozen(Klass, timers = {setTimeout,clearTimeout}) {
  const file='apps/server/src/repository/repository.service.ts',source=readFrozen(file);
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='RepositoryService');
  const nodes=['getWorktrees','withWorktrees'].map(name=>{const m=klass.members.filter(n=>n.name?.getText(ast)===name);assert.equal(m.length,1);return {name,text:m[0].getText(ast),line:ast.getLineAndCharacterOfPosition(m[0].getStart(ast)).line+1};});
  if(!extraction){extraction=nodes;proof('worktree-list-service-extraction',{baseline,file,fileSha256:hash(source),nodes:nodes.map(n=>({...n,sha256:hash(n.text)})),credited:['getWorktrees'],dependencyOnly:['withWorktrees']});}
  const constantFile='packages/shared/src/types/repository.ts',constantSource=readFrozen(constantFile),constantAst=ts.createSourceFile(constantFile,constantSource,ts.ScriptTarget.Latest,true);
  const declarations=constantAst.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]);const constant=declarations.find(n=>n.name.getText(constantAst)==='REPOSITORY_STATUS_TIMEOUT_MS');assert(constant);const timeout=vm.runInNewContext(constant.initializer.getText(constantAst));assert.equal(timeout,10000);
  const m={exports:{}};
  class GatewayTimeoutException extends Error {}
  vm.runInNewContext(ts.transpileModule('export class Frozen {\n'+nodes.map(n=>n.text).join('\n')+'\n}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,GitWorktrees:Klass,AbortController,GatewayTimeoutException,REPOSITORY_STATUS_TIMEOUT_MS:timeout,...timers});
  return new m.exports.Frozen();
}
function frozenWorktrees(){
  const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const file='packages/ssh-client/src/'+name+'.ts',source=readFrozen(file),m={exports:{}};cache.set(name,m.exports);
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Buffer,process,AbortSignal,require:id=>{if(id==='util'||id==='node:path')return require(id);assert(['./worktrees','./git-shell','./repository-path','./repository-transport'].includes(id));return load(id.slice(2));}});return m.exports;}
  return load('worktrees').GitWorktrees;
}
function snapshot(directory){const files={},modes={},links={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=path.relative(directory,f);modes[r]=fs.lstatSync(f).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(f);else if(e.isDirectory())walk(f);else if(e.isFile())files[r]=hash(fs.readFileSync(f));}}walk(directory);return {files,modes,links};}
const query=(reader,p)=>reader.query({id:'repo',path:p,resource:{agentId:'a',resourceId:'repo'}},{resource:{agentId:'a',resourceId:'repo'},kind:'worktrees',params:{}});
const environment={GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'};

test('P0 worktree service frozen delegate preserves lookup path signal value errors and configured deadline',async()=>{
  const rows=[];
  for(const mode of ['success','lookup-error','connection-error','list-error','timeout']){
    const timers=[],trace=[],reason=Error(mode),value=[{path:"/literal 中 '\n",isCurrent:true}];let child;
    class Worktrees{constructor(c){assert.equal(c.marker,true);}list(p,s){trace.push('list');assert.equal(p,value[0].path);child=s;if(mode==='list-error')throw reason;if(mode==='timeout')return new Promise(()=>{});return Promise.resolve(value);}}
    const s=frozen(Worktrees,{setTimeout:(fn,ms)=>{const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimeout:t=>t.cleared=true});
    s.get=async id=>{trace.push('get');assert.equal(id,'opaque');if(mode==='lookup-error')throw reason;return {path:value[0].path};};
    s.connection=async(repo,signal)=>{trace.push('connection');if(mode==='connection-error')throw reason;return {marker:true};};
    const pending=s.getWorktrees('opaque');pending.catch(()=>{});await new Promise(r=>setImmediate(r));assert.equal(timers[0].ms,10000);
    if(mode==='timeout')timers[0].fn();
    if(mode==='success')assert.equal(await pending,value);
    else await assert.rejects(pending,e=>mode==='timeout'?e.message==='Worktree 查询超时，请重试':e===reason);
    assert(timers[0].cleared);if(mode==='timeout')assert(child.aborted);
    assert.deepEqual(trace,mode==='lookup-error'?['get']:mode==='connection-error'?['get','connection']:['get','connection','list']);
    rows.push({mode,trace,configuredTimeoutMs:10000,timerCleared:true,childAborted:child?.aborted??null,errorIdentity:mode.endsWith('error')});
  }
  proof('worktree-list-service-frozen',{rows,boundary:'Exact getWorktrees plus dependency withWorktrees. Controlled deadline seam; no elapsed wallclock assertion. Only getWorktrees credited.'});
});

test('P0 worktree service current query preserves transport failures cancellation and list argv',async()=>{
  const rows=[];
  for(const mode of ['success','throw','nonzero','preabort','inflight','closed']){
    const c=new AbortController(),reason=Error(mode),calls=[];if(mode==='preabort'||mode==='closed')c.abort(reason);
    const connection={signal:c.signal,execGit:async(p,args,s,options)=>{calls.push({path:p,args:[...args],options});s?.throwIfAborted();if(mode==='throw')throw reason;if(mode==='nonzero')return {exitCode:128,stdout:'',stderr:'list denied'};if(mode==='inflight')return new Promise((_,reject)=>{s.addEventListener('abort',()=>reject(s.reason),{once:true});queueMicrotask(()=>c.abort(reason));});return {exitCode:0,stdout:args[0]==='worktree'?'worktree /repo\0HEAD abc\0branch refs/heads/main\0\0':args[1]==='--is-bare-repository'?'false\n':'/repo\n',stderr:''};},withSftp:run=>run({realpath:(p,cb)=>cb(null,p)})};
    if(mode==='closed') {const native=new NativeRepositoryConnection();native.close();await assert.rejects(query(new RepositoryReader(native),'/repo'));rows.push({mode,rejected:true});continue;}
    const pending=query(new RepositoryReader(connection),'/repo');
    if(mode==='success'){const value=await pending;assert.equal(value.length,1);assert.equal(value[0].isCurrent,true);assert.deepEqual(calls.map(c=>c.args),[['worktree','list','--porcelain','-z'],['rev-parse','--is-bare-repository'],['rev-parse','--show-toplevel']]);}
    else await assert.rejects(pending,e=>mode==='nonzero'?e.message==='无法读取 Worktree：list denied':e===reason);
    assert.equal(calls.length,mode==='preabort'?0:mode==='success'?3:1);
    for(const call of calls){assert.equal(call.options.strictUtf8,true);assert.equal(call.options.maxOutputBytes,1048576);}
    rows.push({mode,calls,rejected:mode!=='success'});
  }
  proof('worktree-list-service-current',{rows,boundary:'Compiled RepositoryReader.query with controlled transport. Connection lifetime cancellation, not SDK inflight cancellation. Current RPC has existing 120000ms overall read deadline versus original helper 10000ms; no timeout equivalence claim.'});
});

test('P0 worktree service native original and current list main linked detached locked prunable aliases and two roots without writes',async t=>{
  const fixtures=[createRepository(),createRepository()];fixtures.forEach(f=>t.after(f.close));const Klass=frozenWorktrees(),rows=[];
  for(const f of fixtures){const linked=path.join(f.root,"linked 中 '\nend"),detached=path.join(f.root,'detached'),stale=path.join(f.root,'stale');f.git('worktree','add','-qb','service/linked',linked);f.git('worktree','add','-q','--detach',detached);f.git('worktree','lock','--reason','kept for test',linked);f.git('worktree','add','-qb','service/stale',stale);fs.rmSync(stale,{recursive:true});const alias=path.join(f.root,'alias');fs.symlinkSync(linked,alias);const nested=path.join(linked,'nested');fs.mkdirSync(nested);
    const before=snapshot(f.root),connection=new NativeRepositoryConnection();t.after(()=>connection.close());
    const service=frozen(Klass);service.get=async id=>({path:id});service.connection=async()=>connection;
    const cases=[];for(const directory of [f.repo,linked,detached,alias,nested]){const original=plain(await service.getWorktrees(directory)),current=plain(await query(new RepositoryReader(connection),directory));assert.deepEqual(current,original);assert.equal(current.filter(x=>x.isCurrent).length,1);const actual=fs.realpathSync(execFileSync('git',['-C',directory,'rev-parse','--show-toplevel'],{encoding:'utf8'}).replace(/\r?\n$/,''));assert.equal(current.find(x=>x.isCurrent).path,actual);assert.equal(current.find(x=>x.path===fs.realpathSync(linked)).locked,true);assert.equal(current.find(x=>x.path===fs.realpathSync(linked)).lockedReason,'kept for test');assert.equal(current.find(x=>x.path===path.join(fs.realpathSync(f.root),'stale')).prunable,true);assert.equal(current.find(x=>x.path===fs.realpathSync(detached)).detached,true);cases.push({directory,original,current});}
    const after=snapshot(f.root);assert.deepEqual(after,before);rows.push({root:f.root,cases,before,after});
  }
  proof('worktree-list-service-native',{rows,boundary:'Two real native roots, exact service method and helper over full frozen modules versus compiled current query. Setup before snapshots. Original Nest runtime not started; no SSH or Windows claim.'});
});

test('P0 worktree service actual SDK lists owning resources rejects foreign paths and private RPC and preabort',async t=>{
  const {spawnAgent}=require('@alune/agent-client/node'),fixtures=[createRepository(),createRepository()];fixtures.forEach(f=>t.after(f.close));const linked=path.join(fixtures[0].root,'linked');fixtures[0].git('worktree','add','-qb','service/sdk',linked);
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b55-sdk-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));const agents=['a','b'].map(n=>spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(state,n)],{env:{...process.env,...environment}}));
  try{const [a,b]=agents,identities=await Promise.all(agents.map(a=>a.client.initialize()));assert.notEqual(identities[0].agentId,identities[1].agentId);const main=(await a.client.registerRepository(fixtures[0].repo)).resource,link=(await a.client.registerRepository(linked)).resource,foreign=(await b.client.registerRepository(fixtures[1].repo)).resource;
    const before=fixtures.map(f=>snapshot(f.root)),rows=[];
    for(const [client,resource,directory] of [[a.client,main,fixtures[0].repo],[a.client,link,linked],[b.client,foreign,fixtures[1].repo]]){const result=await client.readRepository(resource,'worktrees',{});assert.equal(result.filter(x=>x.isCurrent).length,1);assert.equal(result.find(x=>x.isCurrent).path,fs.realpathSync(directory));rows.push({resource,result});}
    for(const [client,resource] of [[a.client,foreign],[b.client,main],[b.client,link]])await assert.rejects(client.readRepository(resource,'worktrees',{}),e=>e.kind==='not-found');
    await assert.rejects(a.client.request('repositories.read',{resource:main,kind:'worktrees',params:{path:fixtures[1].repo}}),e=>e.kind==='invalid-params');
    for(const method of ['getWorktrees','repositories.getWorktrees','withWorktrees'])await assert.rejects(a.client.request(method,{resource:main}),e=>e.kind==='unknown-method');
    const c=new AbortController();c.abort();await assert.rejects(a.client.readRepository(link,'worktrees',{},{signal:c.signal}),e=>e.kind==='cancelled');const after=fixtures.map(f=>snapshot(f.root));assert.deepEqual(after,before);
    proof('worktree-list-service-sdk',{agentIds:identities.map(x=>x.agentId),rows,foreignRejections:3,strictParams:true,privateRpcRejections:3,preabort:true,before,after,boundary:'Actual SDK stdio Agents. SDK preabort only; inflight proven at direct query seam. Separate companion write unknown/no-replay regressions are not read-only mutation injections.'});
  }finally{await Promise.all(agents.map(a=>a.close()));}
});
