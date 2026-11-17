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
  if (process.env.P0_STAGED_DIFF_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_STAGED_DIFF_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if(cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/'+name+'.ts';
    const source = fs.readFileSync(path.join(process.env.P0_STAGED_DIFF_FROZEN,file),'utf8');
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
function raw(f) { return f.git('--literal-pathspecs',...argv); }
const prefix = argv.slice(0,-3);
const diffArgs = ['--unified=3'];
const diffLimit = 96 * 1024;
const readFailure = '无法读取暂存差异，请检查仓库连接与 Git 状态。';
const expectedArgs = [...prefix,...diffArgs];
const fallbackPrefix = ['-c','filter.lfs.required=false','-c','filter.lfs.process=','-c','filter.lfs.clean=','-c','filter.lfs.smudge='];
test('P0 staged diff frozen and current preserve exact args UTF8 byte limits status and transport errors',async()=>{
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const [args,max,value] of [
      [diffArgs,diffLimit,''],[diffArgs,diffLimit,'é'.repeat(diffLimit/2)],
      [['--raw','--no-abbrev','-z'],limit,'a'.repeat(limit)],
      [['--name-only','-z','--',"literal \'\"$()\\\n中文"],8,'éééé'],
      [[],0,''],
    ]) {
      const f=scripted(value),s=signal(),before=[...args];
      const result=await new Klass(f.connection,'/literal repo').diff(args,s,max);
      assert.equal(result,value);assert.equal(f.calls.length,1);assert.deepEqual(args,before);
      assert.deepEqual(f.calls[0].args,[...prefix,...args]);assert.equal(f.calls[0].repo,'/literal repo');
      assert.equal(f.calls[0].signal,s);assert.deepEqual(f.calls[0].options,{maxOutputBytes:max});
      rows.push({version,bytes:Buffer.byteLength(value),max,args:f.calls[0].args,options:f.calls[0].options,resultSha256:hash(result)});
    }
    for(const [max,value] of [[diffLimit,'é'.repeat(diffLimit/2)+'a'],[8,'ééééa'],[0,'a']]) {
      const f=scripted(value);await assert.rejects(new Klass(f.connection,'/repo').diff(diffArgs,signal(),max),errorIs(limitMessage,413));assert.equal(f.calls.length,1);
      rows.push({version,bytes:Buffer.byteLength(value),max,error:limitMessage,statusCode:413});
    }
    for(const value of [new CommandOutputLimitError(),()=>({exitCode:7,stdout:'not success',stderr:'literal failure'})]) {
      const f=scripted(value);await assert.rejects(new Klass(f.connection,'/repo').diff(diffArgs,signal(),diffLimit),errorIs(value instanceof Error?limitMessage:readFailure,value instanceof Error?413:502));assert.equal(f.calls.length,1);
      rows.push({version,error:value instanceof Error?limitMessage:readFailure,statusCode:value instanceof Error?413:502});
    }
    const reason=new Error('synthetic diff transport error'),f=scripted(reason);
    await assert.rejects(new Klass(f.connection,'/repo').diff(diffArgs,signal(),diffLimit),e=>e===reason);assert.equal(f.calls.length,1);
    const a=new AbortController(),b=new AbortController(),c=scripted('ok',b.signal);await new Klass(c.connection,'/repo').diff(diffArgs,a.signal,diffLimit);
    const combined=c.calls[0].signal;assert.notEqual(combined,a.signal);assert.notEqual(combined,b.signal);b.abort(reason);assert.equal(combined.reason,reason);
    const calls=[],lfs={async execGit(repo,args,s,options){calls.push(JSON.parse(JSON.stringify({repo,args,options})));return calls.length===1?{exitCode:128,stdout:'',stderr:'git-lfs: command not found'}:{exitCode:0,stdout:'bounded fallback',stderr:''};}};
    assert.equal(await new Klass(lfs,'/repo').diff(diffArgs,signal(),diffLimit),'bounded fallback');assert.equal(calls.length,2);
    assert.deepEqual(calls[0].args,expectedArgs);assert.deepEqual(calls[1].args,[...fallbackPrefix,...expectedArgs]);assert.deepEqual(calls[1].options,{maxOutputBytes:diffLimit});
    rows.push({version,lfsFallback:calls});
  }
  proof('staged-diff-matrix',{rows,prefix,diffLimit,rawLimit:limit,unknownErrorIdentity:true,composedSignal:true,boundary:'Private typed helper, no untrusted argument interface. Exact successful string and empty output preserved. Output limit counts UTF8 bytes; raw caller uses 256 KiB with existing shared 96 KiB message. Frozen transport error class mapped to current port class.'});
});
async function measuredDiff(f,connection,rows,label,expectedError=null) {
  const input=f.git('--literal-pathspecs',...expectedArgs),before=snapshot(f),results=[];
  for(const [version,Klass] of versions()) {
    const helper=new Klass(connection,f.repo);
    if(expectedError) await assert.rejects(helper.diff(diffArgs,signal(),diffLimit),errorIs(...expectedError));
    else {const diff=await helper.diff(diffArgs,signal(),diffLimit);assert.equal(diff,input);results.push({version,diffSha256:hash(diff),diff});}
    assert.deepEqual(snapshot(f),before,'Read diff changed repository '+version+' '+label);
  }
  rows.push({label,independentDiff:input,bytes:Buffer.byteLength(input),independentSha256:hash(input),results,expectedError,before,after:snapshot(f)});
  return input;
}
async function realDiff(t,ssh) {
  const fixtures=[],closers=[];t.after(async()=>{for(const c of closers.reverse())await c();for(const f of fixtures)f.close();});
  async function connect(f){if(ssh){const r=await connectFixture(f);closers.push(()=>r.close());return r.connection;}const c=new NativeRepositoryConnection();closers.push(()=>c.close());return c;}
  const f=createRepository();fixtures.push(f);const c=await connect(f),rows=[];
  assert.equal(await measuredDiff(f,c,rows,'empty returns empty'),'');
  const literal="暂存\t'\"$()\\\nfile.txt";f.write(literal,'STAGED ONLY\n');f.git('add','--',literal);
  const first=await measuredDiff(f,c,rows,'literal staged addition');assert(first.includes('+STAGED ONLY'));
  f.write(literal,'UNSTAGED SECRET\n');f.write('untracked.txt','UNTRACKED SECRET\n');
  const second=await measuredDiff(f,c,rows,'unstaged and untracked excluded');assert.equal(second,first);assert(!second.includes('UNSTAGED SECRET'));assert(!second.includes('UNTRACKED SECRET'));
  f.write('binary.bin',Buffer.from([0,1,255,10,0]));f.git('add','--','binary.bin');
  fs.symlinkSync('../outside-target',path.join(f.repo,'link'));f.git('add','--','link');
  f.git('mv','--','tracked.txt','renamed.txt');f.git('update-index','--chmod=+x','--','renamed.txt');
  const complex=await measuredDiff(f,c,rows,'binary mode symlink rename as delete add');
  assert(complex.includes('Binary files'));assert(!complex.includes('GIT binary patch'));assert(complex.includes('new file mode 120000'));assert(complex.includes('new file mode 100755'));assert(complex.includes('deleted file mode 100644'));assert(!complex.includes('rename from'));
  const marker=path.join(f.root,'filter-executed'),converter=path.join(f.root,'unexpected-filter.sh');
  fs.writeFileSync(converter,'#!/bin/sh\necho invoked > "'+marker+'"\necho CONVERTED_SECRET\n',{mode:0o700});
  f.write('.gitattributes','*.txt diff=fixture\n');f.git('config','diff.fixture.textconv',converter);f.git('config','diff.external',converter);f.git('config','color.ui','always');
  const noFilters=await measuredDiff(f,c,rows,'external diff textconv and color disabled');
  assert.equal(noFilters,complex);assert(!fs.existsSync(marker));assert(!noFilters.includes('CONVERTED_SECRET'));assert(!noFilters.includes('\x1b['));
  const u=createRepository({initial:false});fixtures.push(u);u.write('unborn.txt','FIRST COMMIT\n');u.git('add','--','unborn.txt');assert((await measuredDiff(u,await connect(u),rows,'unborn staged content')).includes('+FIRST COMMIT'));
  const big=createRepository();fixtures.push(big);big.write('large.txt','LARGE STAGED LINE\n'.repeat(7000));big.git('add','--','large.txt');
  assert(Buffer.byteLength(big.git(...expectedArgs))>diffLimit);await measuredDiff(big,await connect(big),rows,'actual patch output limit',[limitMessage,413]);
  const before=snapshot(f),abort=new AbortController(),reason=new Error('preabort real diff');abort.abort(reason);
  for(const [,Klass] of versions())await assert.rejects(new Klass(c,f.repo).diff(diffArgs,abort.signal,diffLimit),e=>e===reason);
  assert.deepEqual(snapshot(f),before);
  proof(ssh?'staged-diff-real-ssh':'staged-diff-real-native',{rows,allMeasuredSnapshotsUnchanged:true,realPreabort:true,filterMarkerAbsent:!fs.existsSync(marker),boundary:ssh?'Encrypted loopback SSH only; no external deployed SSH claim. Fixture writes occur before measured read intervals.':'Real native Git on current Mac; all repo/Git ordinary bytes modes symlinks HEAD refs index remain unchanged during helper calls.'});
}
test('P0 staged diff frozen and current real native match independent patches without writes or filters',async t=>realDiff(t,false));
test('P0 staged diff frozen and current real SSH match independent patches without writes or filters',async t=>realDiff(t,true));
test('P0 staged diff cancellation preserves reasons and current rejects cancelled LFS fallback',async()=>{
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const source of ['caller','connection']) {
      const a=new AbortController(),b=new AbortController(),reason=new Error('cancel '+source);(source==='caller'?a:b).abort(reason);
      const f=scripted('patch',b.signal);await assert.rejects(new Klass(f.connection,'/repo').diff(diffArgs,a.signal,diffLimit),e=>e===reason);assert.equal(f.calls.length,0);
      rows.push({version,source,phase:'preabort',dispatches:0});
    }
    const a=new AbortController(),reason=new Error('in flight diff abort'),f=scripted(s=>new Promise((resolve,reject)=>{s.addEventListener('abort',()=>reject(s.reason),{once:true});queueMicrotask(()=>a.abort(reason));}));
    await assert.rejects(new Klass(f.connection,'/repo').diff(diffArgs,a.signal,diffLimit),e=>e===reason);assert.equal(f.calls.length,1);
    rows.push({version,phase:'controlled in-flight transport',dispatches:1});
    const abort=new AbortController(),fallbackReason=new Error('cancelled before LFS retry'),calls=[];
    const connection={async execGit(repo,args,s,options){calls.push({args,options});if(calls.length===1){abort.abort(fallbackReason);return {exitCode:128,stdout:'',stderr:'git-lfs: command not found'};}assert.equal(s.reason,fallbackReason);throw s.reason;}};
    await assert.rejects(new Klass(connection,'/repo').diff(diffArgs,abort.signal,diffLimit),e=>e===fallbackReason);
    assert.equal(calls.length,version==='current'?1:2);
    rows.push({version,phase:'abort while LFS error completes',dispatches:calls.length,reasonIdentity:true});
  }
  proof('staged-diff-cancellation',{rows,boundary:'Controlled transport in-flight rejection and real native/SSH preabort. Frozen transport dispatched an extra cancelled LFS fallback; current guard from batch31 rejects before second dispatch. Explicit safety improvement, no parity or remote process-tree termination claim for that case.'});
});
test('P0 staged diff real read consumer enforces raw patch raw sequence and rejects index races',async t=>{
  const f=createRepository();t.after(f.close);const native=new NativeRepositoryConnection();t.after(()=>native.close());
  f.write('read.txt','READ STAGED\n');f.git('add','--','read.txt');f.write('read.txt','UNSTAGED CONTENT\n');const rows=[];
  for(const [version,Klass] of versions()) {
    const calls=[],connection={async execGit(repo,args,s,options){calls.push(JSON.parse(JSON.stringify({repo,args,options})));return native.execGit(repo,args,s,options);}};
    const before=snapshot(f),result=await new Klass(connection,f.repo).read(signal());
    assert.deepEqual(JSON.parse(JSON.stringify(result)),{revision:hash(f.git(...argv)),diff:f.git(...expectedArgs)});assert(!result.diff.includes('UNSTAGED CONTENT'));
    assert.deepEqual(calls.map(c=>c.args),[argv,expectedArgs,argv]);assert.deepEqual(calls.map(c=>c.options.maxOutputBytes),[limit,diffLimit,limit]);assert.deepEqual(snapshot(f),before);
    let dispatched=0;const race={async execGit(repo,args,s,options){dispatched++;const res=await native.execGit(repo,args,s,options);if(dispatched===2){f.write('race.txt','INDEX CHANGED\n');f.git('add','--','race.txt');}return res;}};
    await assert.rejects(new Klass(race,f.repo).read(signal()),errorIs('暂存内容已变化，本次结果已丢弃，请重新生成。',409));assert.equal(dispatched,3);
    f.git('rm','--cached','--','race.txt');fs.unlinkSync(path.join(f.repo,'race.txt'));assert.equal(hash(f.git(...argv)),result.revision);
    rows.push({version,result,calls,raceRejected:true,dispatched});
  }
  proof('staged-diff-read',{rows,boundary:'Real native reader integration; intentional disposable index race outside readonly snapshot interval; index cleaned between versions. read/assertRevision are companion checks, no additional ledger credit.'});
});
test('P0 staged diff real staged AI integration returns fingerprints rejects changed index and isolates repositories',async t=>{
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
  proof('staged-diff-ai',{rows,boundary:'Current real AiService with real frozen/current staged reader and real native Git. Synthetic settings/provider and injected fetch only; intentional fixture race changes temporary index, rejected 409 and explicit fixture cleanup. Not a provider network or RPC test.'});
});
test('P0 staged diff actual SDK isolates owning staged diffs rejects foreign resources and exposes no revision RPC',async t=>{
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
    for(const method of ['staged.revision','StagedChanges.revision','staged.diff','StagedChanges.diff','git.execute'])await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');
    const c=new AbortController();c.abort();await assert.rejects(child.client.readRepository(resource,'diff',{staged:true},{signal:c.signal}),e=>e.kind==='cancelled');
    assert.deepEqual(snapshot(f),before);assert.deepEqual(snapshot(other),otherBefore);
    proof('staged-diff-sdk',{resource,otherResource,first,second,before,otherBefore,unchanged:true,foreignRejected:true,typedParams:true,helperRPCAbsent:true,preabort:true,boundary:'Current SDK/stdio typed diff only. Revision helper stays internal; not claiming public AI generate RPC or remote Agent deployment.'});
  } finally {await child.close();}
});
