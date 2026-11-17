const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createRepository } = require('./helpers/local-repository.cjs');
const { connectFixture } = require('./helpers/ssh-server.cjs');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { StagedChanges } = require('../dist/modules/git/staged-changes');
const { CommandOutputLimitError } = require('../dist/ports/process');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
const limit = 256 * 1024;
const argv = ['diff','--cached','--no-color','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=none','--raw','--no-abbrev','-z'];
const emptyMessage = '没有已暂存的改动，请先暂存需要提交的文件。';
const conflictMessage = '请先解决暂存区中的合并冲突。';
const limitMessage = '已暂存差异超过 AI 生成限制（96 KiB），请减少本次暂存内容后重试。';
const signal = () => new AbortController().signal;
function proof(name, value) {
  if (process.env.P0_STAGED_REVISION_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_STAGED_REVISION_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if(cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/'+name+'.ts';
    const source = fs.readFileSync(path.join(process.env.P0_STAGED_REVISION_FROZEN,file),'utf8');
    assert.equal(source,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
    const module={exports:{}};cache.set(name,module.exports);
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
      module,exports:module.exports,Buffer,Error,process,AbortSignal,AbortController,
      require(id){
        if(id.startsWith('node:')) return require(id);
        // The legacy error type is the same transport port error in current execution.
        if(id==='./connection-manager')return {CommandOutputLimitError};
        assert(['staged-changes','repository-transport','git-shell'].some(n=>id==='./'+n),'Unexpected frozen dependency '+id);
        return load(id.slice(2));
      },
    },{filename:file});
    return module.exports;
  }
  return load('staged-changes').StagedChanges;
}
const versions = () => [['frozen',frozen()],['current',StagedChanges]];
const errorIs = (message,statusCode) => e => {assert.equal(e.message,message);assert.equal(e.statusCode,statusCode);assert.equal(e.name,'Error');return true;};
function scripted(result,connectionSignal) {
  const calls=[];
  return {calls,connection:{signal:connectionSignal,async execGit(repo,args,s,options){
    calls.push({repo,args:JSON.parse(JSON.stringify(args)),signal:s,options:JSON.parse(JSON.stringify(options))});
    if(result instanceof Error)throw result;
    return typeof result==='function'?result(s):{exitCode:0,stdout:result,stderr:''};
  },withSftp(){throw Error('No filesystem access expected');}}};
}
test('P0 staged revision frozen and current hash exact raw bytes with precise argv limits errors and signal propagation',async()=>{
  const rows=[];
  const raw = ':100644 100644 '+ 'a'.repeat(40)+' '+ 'b'.repeat(40)+' M\0中文\t\n\'"$()\\.txt\0';
  for(const [version,Klass] of versions()) {
    for(const value of ['abc',raw,'\0',':100644 100644 a b U\nfile\0', 'é'.repeat(limit/2)]) {
      const f=scripted(value),s=signal(),revision=await new Klass(f.connection,'/literal repo').revision(s);
      assert.equal(revision,hash(value));
      if(value==='abc')assert.equal(revision,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args,argv);
      assert.equal(f.calls[0].repo,'/literal repo');assert.equal(f.calls[0].signal,s);assert.deepEqual(f.calls[0].options,{maxOutputBytes:limit});
      rows.push({version,bytes:Buffer.byteLength(value),revision,args:f.calls[0].args,options:f.calls[0].options});
    }
    for(const [value,msg,status] of [
      ['',emptyMessage,400],
      [':100644 100644 '+ '0'.repeat(40)+' '+ '0'.repeat(40)+' U\0conflict\0',conflictMessage,400],
      ['é'.repeat(limit/2)+'a',limitMessage,413],
    ]) {
      const f=scripted(value);await assert.rejects(new Klass(f.connection,'/repo').revision(signal()),errorIs(msg,status));assert.equal(f.calls.length,1);
      rows.push({version,bytes:Buffer.byteLength(value),error:msg,statusCode:status});
    }
    for(const value of [new CommandOutputLimitError(),()=>({exitCode:7,stdout:raw,stderr:'literal failure'})]) {
      const f=scripted(value);await assert.rejects(new Klass(f.connection,'/repo').revision(signal()),errorIs(value instanceof Error?limitMessage:'无法读取暂存差异，请检查仓库连接与 Git 状态。',value instanceof Error?413:502));assert.equal(f.calls.length,1);
    }
    const reason=new Error('synthetic transport fault'),f=scripted(reason);
    await assert.rejects(new Klass(f.connection,'/repo').revision(signal()),e=>e===reason);assert.equal(f.calls.length,1);
    const a=new AbortController(),b=new AbortController(),c=scripted(raw,b.signal);await new Klass(c.connection,'/repo').revision(a.signal);
    const combined=c.calls[0].signal;assert.notEqual(combined,a.signal);assert.notEqual(combined,b.signal);b.abort(reason);assert.equal(combined.reason,reason);
  }
  proof('staged-revision-matrix',{rows,exactArgv:argv,limit,knownSha256Vector:true,byteNotCharacterBound:true,unknownErrorIdentity:true,signalComposition:true,boundary:'Tolerant raw string hashing and exact U-NUL conflict pattern; not a general raw parser or authorization interface. Existing 413 message says 96 KiB although revision raw limit is 256 KiB.'});
});
function snapshot(f) {
  const files={},links={},modes={};
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name),r=path.relative(f.repo,p);
    modes[r]=fs.lstatSync(p).mode;
    if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile())files[r]=hash(fs.readFileSync(p));
  }}walk(f.repo);
  let head=null,refs='';try{head=f.git('rev-parse','--verify','HEAD').trim();refs=f.git('show-ref');}catch{}
  return {head,refs,index:fs.existsSync(path.join(f.repo,'.git/index'))?hash(fs.readFileSync(path.join(f.repo,'.git/index'))):null,files,links,modes};
}
function raw(f) {return f.git('--literal-pathspecs',...argv);}
async function measured(f,connection,expectedError,rows,label) {
  const input=raw(f),before=snapshot(f),versionsResults=[];
  for(const [version,Klass] of versions()) {
    if(expectedError)await assert.rejects(new Klass(connection,f.repo).revision(signal()),errorIs(...expectedError));
    else {
      const revision=await new Klass(connection,f.repo).revision(signal());assert.equal(revision,hash(input));
      versionsResults.push({version,revision});
    }
    assert.deepEqual(snapshot(f),before,'Read helper changed repository '+version+' '+label);
  }
  rows.push({label,raw:input,rawBytes:Buffer.byteLength(input),independentHash:hash(input),expectedError,versionsResults,before,after:snapshot(f)});
  return hash(input);
}
async function real(t,ssh) {
  const fixtures=[],closers=[];t.after(async()=>{for(const c of closers.reverse())await c();for(const f of fixtures)f.close();});
  async function connection(f){if(ssh){const remote=await connectFixture(f);closers.push(()=>remote.close());return remote.connection;}const c=new NativeRepositoryConnection();closers.push(()=>c.close());return c;}
  const f=createRepository();fixtures.push(f);const c=await connection(f),rows=[];
  await measured(f,c,[emptyMessage,400],rows,'clean empty stage');
  const literal="暂存\t'\"$()\\\nfile.txt";
  f.write(literal,'only staged content\n');f.git('add','--',literal);
  const first=await measured(f,c,null,rows,'literal staged addition');
  f.write(literal,'unstaged must not change revision\n');f.write('untracked.txt','ignored\n');
  const unstaged=await measured(f,c,null,rows,'unstaged and untracked ignored');assert.equal(unstaged,first);
  f.git('add','--',literal);const second=await measured(f,c,null,rows,'restaged content changes hash');assert.notEqual(second,first);
  f.write('binary.bin',Buffer.from([0,1,255,10,0]));f.git('add','--','binary.bin');
  fs.symlinkSync('../outside-target',path.join(f.repo,'link'));f.git('add','--','link');
  f.git('mv','--','tracked.txt','renamed.txt');
  f.git('update-index','--chmod=+x','--','renamed.txt');
  await measured(f,c,null,rows,'binary symlink rename deletion and executable mode');
  const complex=rows.at(-1).raw;assert(complex.includes(' D\0tracked.txt\0'));assert(complex.includes(' A\0renamed.txt\0'));assert(complex.includes(':000000 120000 '));assert(complex.includes(':000000 100755 '));
  const u=createRepository({initial:false});fixtures.push(u);u.write('unborn.txt','first\n');u.git('add','--','unborn.txt');await measured(u,await connection(u),null,rows,'unborn staged addition');
  const conflict=createRepository();fixtures.push(conflict);const main=conflict.git('symbolic-ref','--short','HEAD').trim();
  conflict.git('checkout','-qb','topic');conflict.write('tracked.txt','topic\n');conflict.git('commit','-am','topic','-q');conflict.git('checkout',main);conflict.write('tracked.txt','main\n');conflict.git('commit','-am','main','-q');
  assert.throws(()=>conflict.git('merge','topic'),e=>e.status===1);
  await measured(conflict,await connection(conflict),[conflictMessage,400],rows,'real merge conflict');assert(rows.at(-1).raw.includes(' U\0tracked.txt\0'));
  const large=createRepository();fixtures.push(large);const blob=large.git('rev-parse','HEAD:tracked.txt').trim();
  const input=Array.from({length:2000},(_,i)=>'100644 '+blob+'\t'+String(i).padStart(5,'0')+'-'+'x'.repeat(90)+'\n').join('');
  execFileSync('git',['-C',large.repo,'update-index','--index-info'],{input,env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  assert(Buffer.byteLength(raw(large))>limit);
  await measured(large,await connection(large),[limitMessage,413],rows,'actual output cap');
  const reason=new Error('preaborted real '+(ssh?'ssh':'native')),abort=new AbortController();abort.abort(reason);const before=snapshot(f);
  for(const [,Klass] of versions())await assert.rejects(new Klass(c,f.repo).revision(abort.signal),e=>e===reason);
  assert.deepEqual(snapshot(f),before);
  proof(ssh?'staged-revision-real-ssh':'staged-revision-real-native',{rows,first,second,unstaged,preabortReasonIdentity:true,allMeasuredSnapshotsUnchanged:true,boundary:ssh?'Encrypted loopback SSH only. Git/files/state owned disposable fixtures; not external deployed host acceptance.':'Real native Git/filesystem on current Mac. Fixture preparations outside measured intervals; revision is raw cached-diff hash, not a concurrency lock.'});
}
test('P0 staged revision frozen and current real native match independent Git fingerprints without repository writes',async t=>real(t,false));
test('P0 staged revision frozen and current real SSH match independent Git fingerprints without repository writes',async t=>real(t,true));
test('P0 staged revision frozen and current transport cancellation preserves reason with zero fallback dispatch',async()=>{
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const source of ['caller','connection']) {
      const a=new AbortController(),b=new AbortController(),reason=new Error('cancel '+source);(source==='caller'?a:b).abort(reason);
      const f=scripted('abc',b.signal);await assert.rejects(new Klass(f.connection,'/repo').revision(a.signal),e=>e===reason);assert.equal(f.calls.length,0);
      rows.push({version,source,phase:'preabort',dispatches:0});
    }
    const a=new AbortController(),reason=new Error('in flight abort'),f=scripted(s=>new Promise((resolve,reject)=>{s.addEventListener('abort',()=>reject(s.reason),{once:true});queueMicrotask(()=>a.abort(reason));}));
    await assert.rejects(new Klass(f.connection,'/repo').revision(a.signal),e=>e===reason);assert.equal(f.calls.length,1);
    rows.push({version,phase:'controlled in-flight transport',dispatches:1});
  }
  proof('staged-revision-cancellation',{rows,reasonIdentity:true,noFallbackDispatch:true,boundary:'Controlled in-flight transport rejection plus real transport preabort in native/SSH tests. No real remote mid-command process-tree termination claim.'});
});
test('P0 staged revision real staged AI integration returns fingerprints rejects changed index and isolates repositories',async t=>{
  const { AiService }=require('../dist/modules/ai/service'),f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);
  f.write('a.txt','FIRST STAGED\n');f.git('add','--','a.txt');f.write('a.txt','UNSTAGED SECRET\n');
  other.write('b.txt','SECOND STAGED\n');other.git('add','--','b.txt');const connection=new NativeRepositoryConnection();t.after(()=>connection.close());
  const provider={id:'fixture',name:'Fixture',enabled:true,protocol:'openai',baseUrl:'https://ai.invalid/v1',models:[{id:'model',enabled:true}]};
  const config={providers:[provider],commit:{providerId:'fixture',modelId:'model',language:'en',format:'conventional',prompt:''}};
  const settings={assertRevision(r){assert.equal(r,'config');},read(){return structuredClone(config);},key(id){assert.equal(id,'fixture');return 'synthetic-only';}};
  const rows=[];
  for(const [version,Klass] of versions()) {
    let releases=0,mutate=false;const calls=[];
    const service=new AiService(settings,async id=>{assert(['first','second'].includes(id));return {staged:new Klass(connection,id==='first'?f.repo:other.repo),release(){releases++;}};},async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      if(mutate){f.write('raced.txt','changed during generation\n');f.git('add','--','raced.txt');}
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({message:'fix: staged result',description:'body'})}}]}),{headers:{'Content-Type':'application/json'}});
    });
    const before=snapshot(f),secondBefore=snapshot(other),result=await service.generate('first','config',signal());
    assert.equal(result.stagedRevision,hash(raw(f)));assert.equal(result.message,'fix: staged result');assert.equal(result.configRevision,'config');
    const firstDiff=JSON.parse(calls[0].body.messages[1].content).stagedDiff;assert(firstDiff.includes('+FIRST STAGED'));assert(!firstDiff.includes('UNSTAGED SECRET'));
    const second=await service.generate('second','config',signal());assert.equal(second.stagedRevision,hash(raw(other)));assert.notEqual(second.stagedRevision,result.stagedRevision);
    const secondDiff=JSON.parse(calls[1].body.messages[1].content).stagedDiff;assert(secondDiff.includes('+SECOND STAGED'));assert(!secondDiff.includes('FIRST STAGED'));assert.deepEqual(snapshot(f),before);assert.deepEqual(snapshot(other),secondBefore);
    mutate=true;await assert.rejects(service.generate('first','config',signal()),errorIs('暂存内容已变化，本次结果已丢弃，请重新生成。',409));assert.equal(releases,3);
    // Remove only this test's temporary index entry between versions; never touch project files.
    f.git('rm','--cached','--','raced.txt');fs.unlinkSync(path.join(f.repo,'raced.txt'));assert.equal(hash(raw(f)),result.stagedRevision);
    rows.push({version,result,second,firstDiff,secondDiff,releases,changedIndexRejected:true});
  }
  proof('staged-revision-ai',{rows,boundary:'Current real AiService with real frozen/current staged reader and real native Git. Synthetic settings/provider and injected fetch only; intentional fixture race changes temporary index, rejected 409 and explicit fixture cleanup. Not a provider network or RPC test.'});
});
test('P0 staged revision actual SDK isolates owning staged diffs rejects foreign resources and exposes no revision RPC',async t=>{
  const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);
  f.write('a.txt','FIRST SDK STAGED\n');f.git('add','--','a.txt');f.write('a.txt','NOT STAGED\n');other.write('b.txt','SECOND SDK STAGED\n');other.git('add','--','b.txt');
  const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(f.root,'state')],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
  try {
    const init=await child.client.initialize(),resource=(await child.client.registerRepository(f.repo)).resource,otherResource=(await child.client.registerRepository(other.repo)).resource;
    assert.equal(resource.agentId,init.agentId);const before=snapshot(f),otherBefore=snapshot(other);
    const first=await child.client.readRepository(resource,'diff',{staged:true}),second=await child.client.readRepository(otherResource,'diff',{staged:true});
    assert(first.includes('+FIRST SDK STAGED'));assert(!first.includes('NOT STAGED'));assert(!first.includes('SECOND SDK STAGED'));assert(second.includes('+SECOND SDK STAGED'));assert(!second.includes('FIRST SDK STAGED'));
    for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}])await assert.rejects(child.client.readRepository(foreign,'diff',{staged:true}),e=>e.kind==='not-found');
    for(const params of [{staged:'yes'},{staged:true,path:other.repo},{staged:true,args:['reset','--hard']}])await assert.rejects(child.client.request('repositories.read',{resource,kind:'diff',params}),e=>e.kind==='invalid-params');
    for(const method of ['staged.revision','StagedChanges.revision','git.execute'])await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');
    const c=new AbortController();c.abort();await assert.rejects(child.client.readRepository(resource,'diff',{staged:true},{signal:c.signal}),e=>e.kind==='cancelled');
    assert.deepEqual(snapshot(f),before);assert.deepEqual(snapshot(other),otherBefore);
    proof('staged-revision-sdk',{resource,otherResource,first,second,before,otherBefore,unchanged:true,foreignRejected:true,typedParams:true,helperRPCAbsent:true,preabort:true,boundary:'Current SDK/stdio typed diff only. Revision helper stays internal; not claiming public AI generate RPC or remote Agent deployment.'});
  } finally {await child.close();}
});
