const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createRepository } = require('./helpers/local-repository.cjs');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { RepositoryReader } = require('../dist/modules/repositories/reads');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
const plain = v => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_COMMIT_FILES_SERVICE_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_COMMIT_FILES_SERVICE_PROOF_DIR, name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
let extracted;
function service(GitCommands) {
  const file='apps/server/src/repository/repository.service.ts';
  const source=fs.readFileSync(path.join(process.env.P0_COMMIT_FILES_SERVICE_FROZEN,file),'utf8');
  assert.equal(source,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='RepositoryService');
  const nodes=klass.members.filter(n=>n.name?.getText(ast)==='getCommitFiles');assert.equal(nodes.length,1);
  const text=nodes[0].getText(ast);
  if(!extracted){extracted=text;proof('commit-files-service-extraction',{baseline,file,fileSha256:hash(source),name:'getCommitFiles',line:ast.getLineAndCharacterOfPosition(nodes[0].getStart(ast)).line+1,text,sha256:hash(text),credited:['getCommitFiles'],dependencyOnly:['GitCommands.commitFiles and its parsers']});}
  const m={exports:{}};
  vm.runInNewContext(ts.transpileModule('export class Frozen {\n'+text+'\n}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,GitCommands,Error});
  return new m.exports.Frozen();
}
function frozenGit() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_COMMIT_FILES_SERVICE_FROZEN, file), 'utf8');
    assert.equal(source, execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }));
    const module = { exports: {} };
    cache.set(name, module.exports);
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, Buffer, Error, TextDecoder, process, AbortSignal, AbortController, setTimeout, clearTimeout,
      require(id) {
        if (id === 'util' || id.startsWith('node:')) return require(id);
        if (id === '@alune/shared') return require('@alune/domain');
        // Imported by the whole old GitCommands module, unused in the selected methods.
        if (id === './connection-manager') return { CommandOutputLimitError: require('../dist/ports/process').CommandOutputLimitError };
        assert(['git-commands','git-log','git-signing','change-entries','git-status','worktrees','repository-files','repository-transport','git-shell','repository-path','sftp-file','lfs'].some(n => id === './' + n), 'Unexpected frozen dependency ' + id);
        return load(id.slice(2));
      },
    }, { filename: file });
    return module.exports;
  }
  return load('git-commands').GitCommands;
}
function setup(f) {
  f.git('config','commit.gpgSign','false');
  f.write('old name.txt','rename me\nline two\n');
  f.write('delete.txt','delete me\n');
  f.write('binary.dat',Buffer.from([0,1,2]));
  f.git('add','--all');f.git('commit','-qm','root');f.first=f.git('rev-parse','HEAD').trim();
  f.renamed="改名\t'$()\nfile.txt";f.added='new "quote" \\name.txt';
  f.git('mv','--','old name.txt',f.renamed);
  f.write(f.added,'one\ntwo\n');
  f.write('binary.dat',Buffer.from([0,3,4,5]));
  f.git('rm','--','delete.txt');
  f.git('add','--all');f.git('commit','-qm','changes');f.second=f.git('rev-parse','HEAD').trim();
  f.git('commit','--allow-empty','-qm','empty');f.empty=f.git('rev-parse','HEAD').trim();
  f.write('dirty-index.txt','staged\n');f.git('add','--','dirty-index.txt');f.write('dirty-index.txt','unstaged\n');
  fs.symlinkSync('binary.dat',path.join(f.repo,'untracked-link'));
}
function snapshot(f) {
  const files={},modes={},links={};
  function walk(d) { for(const e of fs.readdirSync(d,{withFileTypes:true})) {
    const p=path.join(d,e.name),r=path.relative(f.repo,p);modes[r]=fs.lstatSync(p).mode;
    if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile())files[r]=hash(fs.readFileSync(p));
  }}walk(f.repo);
  return {head:f.git('rev-parse','HEAD').trim(),refs:f.git('show-ref'),index:hash(fs.readFileSync(path.join(f.repo,'.git/index'))),files,modes,links};
}
function expected(f) { return [
  {path:'binary.dat',status:'modified'},
  {path:'delete.txt',status:'deleted',additions:0,deletions:1},
  {path:f.added,status:'added',additions:2,deletions:0},
  {path:f.renamed,oldPath:'old name.txt',status:'renamed',additions:0,deletions:0},
].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))); }
function assertFiles(actual,f) {
  assert.deepEqual(plain(actual),expected(f));
  const binary=actual.find(e=>e.path==='binary.dat');assert.equal(binary.additions,undefined);assert.equal(binary.deletions,undefined);
}
const resource={agentId:'agent',resourceId:'repo'};
const query=(reader,directory,commit,parentCommit)=>reader.query({id:'repo',path:directory,resource},{resource,kind:'commitFiles',params:{commit,...(parentCommit===undefined?{}:{parentCommit})}});
const environment={GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'};

test('P0 commit files service frozen delegate preserves lookup connection path refs result and error identity',async()=>{
  const rows=[];
  for(const parent of [undefined,'parent literal'])for(const mode of ['success','lookup-error','connection-error','helper-error']){
    const trace=[],reason=Error(mode),value=[{path:"中 '\n",status:'modified'}],repo={path:"/repo '$()\n",marker:'repository'},connection={marker:'connection'};
    class Commands{
      constructor(c){assert.equal(c,connection);trace.push('construct');}
      async commitFiles(p,commit,parentCommit){trace.push('commitFiles');assert.equal(p,repo.path);assert.equal(commit,'commit literal');assert.equal(parentCommit,parent);if(mode==='helper-error')throw reason;return value;}
    }
    const s=service(Commands);
    s.get=async id=>{trace.push('get');assert.equal(id,'opaque-id');if(mode==='lookup-error')throw reason;return repo;};
    s.connection=async(...args)=>{trace.push('connection');assert.equal(args.length,1);assert.equal(args[0],repo);if(mode==='connection-error')throw reason;return connection;};
    const pending=s.getCommitFiles('opaque-id','commit literal',parent);
    if(mode==='success')assert.equal(await pending,value);else await assert.rejects(pending,e=>e===reason);
    assert.deepEqual(trace,mode==='lookup-error'?['get']:mode==='connection-error'?['get','connection']:['get','connection','construct','commitFiles']);
    rows.push({mode,parent:parent??null,trace,value:mode==='success'?value:null,errorIdentity:mode!=='success'});
  }
  proof('commit-files-service-frozen',{rows,boundary:'Exact original method AST, dependency stub only for delegate policy. Original method has neither explicit signal parameter nor configured timeout. Full dependencies exercised in native comparison.'});
});

test('P0 commit files service current query preserves exact argv failures cancellation and closed connection rejection',async()=>{
  const rows=[];
  for(const parent of [undefined,'HEAD^'])for(const mode of ['success','empty','transport-first','transport-second','nonzero-first','nonzero-second','preabort','inflight','between','late-final','closed']){
    const controller=new AbortController(),reason=Error(mode),calls=[];
    if(mode==='preabort')controller.abort(reason);
    const connection={signal:controller.signal,async execGit(p,args,signal,options){
      assert.equal(p,'/repo');assert.equal(signal,controller.signal);assert.equal(options,undefined);calls.push({path:p,args:[...args]});
      assert(calls.length<=2,'Unexpected retry');
      if(mode==='transport-first'||mode==='transport-second'&&calls.length===2)throw reason;
      if(mode==='nonzero-first'||mode==='nonzero-second'&&calls.length===2)return {exitCode:7,stdout:'partial',stderr:'denied'};
      if(mode==='inflight')return new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});queueMicrotask(()=>controller.abort(reason));});
      if(mode==='between'&&calls.length===1||mode==='late-final'&&calls.length===2)controller.abort(reason);
      return {exitCode:0,stdout:mode==='empty'?'':calls.length===1?'A\0literal 中\n\0':'2\t0\tliteral 中\n\0',stderr:''};
    }};
    if(mode==='closed'){
      const native=new NativeRepositoryConnection();await native.close();await assert.rejects(query(new RepositoryReader(native),'/repo','HEAD',parent));rows.push({mode,parent:parent??null,rejected:true,calls:[]});continue;
    }
    const pending=query(new RepositoryReader(connection),'/repo','HEAD',parent);
    let result;
    if(['success','empty','late-final'].includes(mode)){
      result=plain(await pending);assert.deepEqual(result,mode==='empty'?[]:[{path:'literal 中\n',status:'added',additions:2,deletions:0}]);
    }else await assert.rejects(pending,e=>mode.startsWith('nonzero')?e.message===(mode.endsWith('first')?'git commit files failed: denied':'git commit file stats failed: denied'):e===reason);
    const number=mode==='preabort'?0:['success','transport-second','nonzero-second','late-final'].includes(mode)?2:1;assert.equal(calls.length,number);
    const expected=parent?[
      ['diff','--no-color','--name-status','-z','-M','HEAD^','HEAD','--'],
      ['diff','--no-color','--numstat','-z','-M','HEAD^','HEAD','--']
    ]:[
      ['show','--first-parent','--format=','--name-status','-z','--find-renames','HEAD','--'],
      ['show','--first-parent','--format=','--numstat','-z','--find-renames','HEAD','--']
    ];assert.deepEqual(calls.map(c=>c.args),expected.slice(0,number));
    rows.push({mode,parent:parent??null,calls,result,rejected:!['success','empty','late-final'].includes(mode)});
  }
  const invalid=[];
  for(const [commit,parent] of [['',undefined],['-p',undefined],['x\0y',undefined],['HEAD',''],['HEAD','-p'],['HEAD','x\0y']]){
    let dispatched=0;const reader=new RepositoryReader({execGit(){dispatched++;throw Error('dispatch must not occur');}});
    await assert.rejects(query(reader,'/repo',commit,parent),{message:'无效的提交引用。'});assert.equal(dispatched,0);invalid.push({commit,parent:parent??null,dispatched});
  }
  proof('commit-files-service-current',{rows,invalid,boundary:'Compiled real current RepositoryReader.query; controlled transport proves cancellation and exact argv. Direct late final completion may succeed; RPC performs its own post-read signal check. No timeout equivalence or atomic snapshot assertion.'});
});

test('P0 commit files service native original and current compare root changed empty range and missing refs at two roots without writes',async t=>{
  const fixtures=[createRepository({initial:false}),createRepository({initial:false})];fixtures.forEach(f=>t.after(f.close));
  const Klass=frozenGit(),rows=[];
  for(const f of fixtures){
    setup(f);const connection=new NativeRepositoryConnection();t.after(()=>connection.close());
    const s=service(Klass);s.get=async id=>{assert.equal(id,'opaque-id');return {path:f.repo};};s.connection=async repo=>{assert.equal(repo.path,f.repo);return connection;};
    const reader=new RepositoryReader(connection),before=snapshot(f),cases=[];
    const initial=[{path:'binary.dat',status:'added'},{path:'delete.txt',status:'added',additions:1,deletions:0},{path:'old name.txt',status:'added',additions:2,deletions:0}];
    for(const [kind,commit,parent,expectedValue] of [['root',f.first,undefined,initial],['changed',f.second,undefined,expected(f)],['empty',f.empty,undefined,[]],['range',f.empty,f.first,expected(f)]]){
      const original=plain(await s.getCommitFiles('opaque-id',commit,parent)),current=plain(await query(reader,f.repo,commit,parent));
      assert.deepEqual(original,expectedValue);assert.deepEqual(current,expectedValue);cases.push({kind,commit,parent:parent??null,original,current,expected:expectedValue});
    }
    const errors=[];for(const [version,operation] of [['original',()=>s.getCommitFiles('opaque-id','missing-ref')],['current',()=>query(reader,f.repo,'missing-ref')]]){
      let message;await assert.rejects(operation(),e=>{message=e.message;return message.startsWith('git commit files failed:');});errors.push({version,message});
    }
    assert.equal(errors[0].message,errors[1].message);
    const after=snapshot(f);assert.deepEqual(after,before);rows.push({root:f.root,cases,errors,before,after});
  }
  proof('commit-files-service-native',{rows,boundary:'Two isolated real Git roots. Exact old service method and twelve whole GitCommands dependencies over native transport versus compiled current query. Setup writes precede snapshot; dirty index/worktree retained. No original Nest runtime, SSH, Windows or external-host pass.'});
});

test('P0 commit files service actual SDK enforces two Agent ownership typed params private RPC absence and preabort',async t=>{
  const {spawnAgent}=require('@alune/agent-client/node'),fixtures=[createRepository({initial:false}),createRepository({initial:false})];fixtures.forEach(f=>{t.after(f.close);setup(f);});
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b56-sdk-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
  const agents=['a','b'].map(n=>spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(state,n)],{env:{...process.env,...environment}}));
  try{
    const identities=await Promise.all(agents.map(a=>a.client.initialize()));assert.notEqual(identities[0].agentId,identities[1].agentId);
    const resources=await Promise.all(agents.map((a,i)=>a.client.registerRepository(fixtures[i].repo).then(r=>r.resource)));
    const before=fixtures.map(snapshot),rows=[];
    for(const [i,agent] of agents.entries()){
      const f=fixtures[i],resource=resources[i];assert.equal(resource.agentId,identities[i].agentId);
      const changed=await agent.client.readRepository(resource,'commitFiles',{commit:f.second});assertFiles(changed,f);
      const range=await agent.client.readRepository(resource,'commitFiles',{commit:f.empty,parentCommit:f.first});assertFiles(range,f);
      const empty=await agent.client.readRepository(resource,'commitFiles',{commit:f.empty});assert.deepEqual(empty,[]);
      await assert.rejects(agent.client.readRepository(resources[1-i],'commitFiles',{commit:f.second}),e=>e.kind==='not-found');
      rows.push({resource,changed,range,empty,expected:expected(f)});
    }
    const invalidParams=[{commit:fixtures[0].second,args:['reset','--hard']},{commit:fixtures[0].second,path:fixtures[1].repo},{commit:fixtures[0].second,file:'binary.dat'},{commit:'HEAD',parentCommit:3},{commit:''},{commit:'-p'},{commit:'bad\0ref'}];
    for(const params of invalidParams)await assert.rejects(agents[0].client.request('repositories.read',{resource:resources[0],kind:'commitFiles',params}),e=>e.kind==='invalid-params');
    const privateMethods=['getCommitFiles','repositories.getCommitFiles','git.commitFiles','_parseCommitNumstat'];
    for(const method of privateMethods)await assert.rejects(agents[0].client.request(method,{resource:resources[0]}),e=>e.kind==='unknown-method');
    const c=new AbortController();c.abort();await assert.rejects(agents[0].client.readRepository(resources[0],'commitFiles',{commit:fixtures[0].second},{signal:c.signal}),e=>e.kind==='cancelled');
    const after=fixtures.map(snapshot);assert.deepEqual(after,before);
    proof('commit-files-service-sdk',{agentIds:identities.map(i=>i.agentId),rows,foreignRejections:2,invalidParams,privateMethods,preabort:true,before,after,boundary:'Two actual stdio SDK Agents, typed resource ownership and request validation. SDK preabort; current inflight cancellation proven separately at direct query seam. No SDK inflight or original lifecycle equivalence claim.'});
  }finally{await Promise.all(agents.map(a=>a.close()));}
});
