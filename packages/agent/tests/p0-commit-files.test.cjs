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
const { GitReads } = require('../dist/modules/git/git-commands');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
function proof(name, value) {
  if (process.env.P0_COMMIT_FILES_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_COMMIT_FILES_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_COMMIT_FILES_FROZEN, file), 'utf8');
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
const versions = () => [['frozen', frozen()], ['current', GitReads]];

test('P0 commit files name-status parser preserves NUL paths rename copy fallback and truncation semantics', () => {
  const literal = "中文\t'\"$()\\\nfile";
  const rows = [
    ['', []], ['\0\0', []],
    ['A\0a\0M\0b\0D\0c\0', [{path:'a',status:'added'},{path:'b',status:'modified'},{path:'c',status:'deleted'}]],
    ['R100\0old\0' + literal + '\0C075\0source\0copy\0', [{path:literal,oldPath:'old',status:'renamed'},{path:'copy',oldPath:'source',status:'copied'}]],
    ['T\0type\0U\0conflict\0X\0unknown\0', ['type','conflict','unknown'].map(path=>({path,status:'modified'}))],
    ['\0A\0\0M\0kept\0', [{path:'kept',status:'modified'}]],
    ['R100\0\0new\0', [{path:'new',oldPath:'',status:'renamed'}]],
    ['R100\0old\0', []], ['C100\0old', []], ['A', []],
    ['A\0unterminated', [{path:'unterminated',status:'added'}]],
    ['M\0 leading / ../.git\0', [{path:' leading / ../.git',status:'modified'}]],
  ];
  for (const [, Klass] of versions()) for (const [input, expected] of rows) {
    assert.deepEqual(plain(new Klass({})._parseCommitNameStatus(input)), expected);
  }
  proof('commit-name-status-matrix', {rows,versions:['frozen','current'],boundary:'Internal tolerant token parser, not public path validation.'});
});

test('P0 commit files numstat parser preserves numeric binary rename and malformed row semantics', () => {
  const rows = [
    ['', []], ['\0bad\0one\ttab\0', []],
    ['0\t12\tfile\0', [{additions:0,deletions:12}]],
    ['003\t0004\tfile\0', [{additions:3,deletions:4}]],
    ['-\t-\tbinary\0', [{}]],
    ['+1\t2.5\tbad counts\0', [{}]],
    [' 1\t2\tfile\0', [{deletions:2}]],
    ['1\t2\t中文\t$()\nfile\0', [{additions:1,deletions:2}]],
    ['5\t6\t\0old\0new\0-\t-\tbinary\0', [{additions:5,deletions:6},{}]],
    ['7\t8\t\0only-old', [{additions:7,deletions:8}]],
    ['1\t2\t\0\0\0\0' + '3\t4\tregular', [{additions:1,deletions:2},{additions:3,deletions:4}]],
  ];
  for (const [, Klass] of versions()) for (const [input, expected] of rows)
    assert.deepEqual(plain(new Klass({})._parseCommitNumstat(input)), expected);
  proof('commit-numstat-matrix', {rows,versions:['frozen','current'],boundary:'Undefined binary or non-digit counts omitted by JSON; permissive malformed rows retained. Stats joined by index in commitFiles.'});
});
function scripted(results, signal) {
  const trace=[];
  return {trace,connection:{signal,async execGit(repo,args,actualSignal,options) {
    trace.push({repo,args:plain(args),hasSignal:!!actualSignal,options});
    assert.equal(actualSignal,signal);
    assert.equal(options,undefined);
    const result=results[trace.length-1];
    assert.notEqual(result,undefined,'Unexpected retry/extra command');
    if (typeof result==='function') return result(actualSignal);
    if (result instanceof Error) throw result;
    return {exitCode:0,stdout:result,stderr:''};
  }}};
}
test('P0 commit files command orchestration validates refs exact argv errors no retries and connection cancellation', async () => {
  const rows=[];
  for (const [version,Klass] of versions()) {
    for (const parent of [undefined,'HEAD^']) {
      const f=scripted(['R100\0old\0new\0M\0binary\0','0\t0\t\0old\0new\0-\t-\tbinary\0']);
      const result=await new Klass(f.connection).commitFiles('/repo','HEAD',parent);
      assert.deepEqual(plain(result),[{path:'new',oldPath:'old',status:'renamed',additions:0,deletions:0},{path:'binary',status:'modified'}]);
      assert.deepEqual(f.trace.map(e=>e.args),parent ? [
        ['diff','--no-color','--name-status','-z','-M','HEAD^','HEAD','--'],
        ['diff','--no-color','--numstat','-z','-M','HEAD^','HEAD','--'],
      ] : [
        ['show','--first-parent','--format=','--name-status','-z','--find-renames','HEAD','--'],
        ['show','--first-parent','--format=','--numstat','-z','--find-renames','HEAD','--'],
      ]);
      rows.push({version,parent:parent??null,result,trace:f.trace});
    }
    const empty=scripted(['']);assert.deepEqual(plain(await new Klass(empty.connection).commitFiles('/repo','HEAD')),[]);assert.equal(empty.trace.length,1);
    for (const [commit,parent] of [['',undefined],['--all',undefined],['a\0b',undefined],['HEAD',''],['HEAD','-p'],['HEAD','p\0x']]) {
      const f=scripted([]);await assert.rejects(new Klass(f.connection).commitFiles('/repo',commit,parent),{message:'无效的提交引用。'});assert.equal(f.trace.length,0);
    }
    for (const stage of [0,1]) {
      const f=scripted(stage ? ['A\0a\0',()=>({exitCode:7,stdout:'partial',stderr:'stats failed\n'})] : [()=>({exitCode:7,stdout:'partial',stderr:'names failed\n'})]);
      await assert.rejects(new Klass(f.connection).commitFiles('/repo','HEAD'),{message:stage?'git commit file stats failed: stats failed\n':'git commit files failed: names failed\n'});assert.equal(f.trace.length,stage+1);
      const reason=new Error('transport '+stage),g=scripted(stage?['A\0a\0',reason]:[reason]);
      await assert.rejects(new Klass(g.connection).commitFiles('/repo','HEAD'),e=>e===reason);assert.equal(g.trace.length,stage+1);
    }
    // The direct helper has no explicit signal parameter. Connection signal controls dispatch.
    const pre=new AbortController(),preReason=new Error('pre');pre.abort(preReason);const a=scripted([],pre.signal);
    await assert.rejects(new Klass(a.connection).commitFiles('/repo','HEAD'),e=>e===preReason);assert.equal(a.trace.length,0);
    const middle=new AbortController(),middleReason=new Error('between');const b=scripted([()=>{middle.abort(middleReason);return {exitCode:0,stdout:'A\0a\0',stderr:''};}],middle.signal);
    await assert.rejects(new Klass(b.connection).commitFiles('/repo','HEAD'),e=>e===middleReason);assert.equal(b.trace.length,1);
    const active=new AbortController(),activeReason=new Error('active');const c=scripted([signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});setTimeout(()=>active.abort(activeReason),5);})],active.signal);
    await assert.rejects(new Klass(c.connection).commitFiles('/repo','HEAD'),e=>e===activeReason);assert.equal(c.trace.length,1);
    const late=new AbortController(),d=scripted(['A\0a\0',()=>{late.abort(new Error('late'));return {exitCode:0,stdout:'1\t0\ta\0',stderr:''};}],late.signal);
    assert.deepEqual(plain(await new Klass(d.connection).commitFiles('/repo','HEAD')),[{path:'a',status:'added',additions:1,deletions:0}]);assert.equal(d.trace.length,2);
    // An internal truncated stat list is joined positionally, without invented values.
    const short=scripted(['A\0a\0D\0b\0','2\t0\ta\0']);
    assert.deepEqual(plain(await new Klass(short.connection).commitFiles('/repo','HEAD')),[{path:'a',status:'added',additions:2,deletions:0},{path:'b',status:'deleted'}]);
  }
  proof('commit-command-matrix',{rows,invalidRefsBeforeDispatch:true,emptySkipsStats:true,exactErrorsAndIdentity:true,noNormalRetries:true,cancellation:['pre','active','between commands'],lateFinalTransportCanSucceed:true,boundary:'No explicit per-call signal, no atomic multi-command snapshot, no retry or rollback claim.'});
});

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
  const files={},links={};
  function walk(d) { for(const e of fs.readdirSync(d,{withFileTypes:true})) {
    const p=path.join(d,e.name),r=path.relative(f.repo,p);
    if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile())files[r]=hash(fs.readFileSync(p));
  }}walk(f.repo);
  return {head:f.git('rev-parse','HEAD').trim(),refs:f.git('show-ref'),index:hash(fs.readFileSync(path.join(f.repo,'.git/index'))),files,links};
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
async function real(t,ssh) {
  const f=createRepository({initial:false});let remote,local;
  t.after(async()=>{await remote?.close();await local?.close();f.close();});setup(f);
  if(ssh)remote=await connectFixture(f);else local=new NativeRepositoryConnection();
  const connection=remote?.connection??local,before=snapshot(f),rows=[];
  for(const [version,Klass] of versions()) {
    const api=new Klass(connection),result=await api.commitFiles(f.repo,f.second);assertFiles(result,f);
    assertFiles(await api.commitFiles(f.repo,f.empty,f.first),f);
    assert.deepEqual(plain(await api.commitFiles(f.repo,f.empty)),[]);
    const initial=await api.commitFiles(f.repo,f.first);
    assert.deepEqual(plain(initial),[{path:'binary.dat',status:'added'},{path:'delete.txt',status:'added',additions:1,deletions:0},{path:'old name.txt',status:'added',additions:2,deletions:0}]);
    await assert.rejects(api.commitFiles(f.repo,'missing-ref'),e=>e.message.startsWith('git commit files failed:'));
    assert.deepEqual(snapshot(f),before);rows.push({version,result,initial,before,after:snapshot(f)});
  }
  proof(ssh?'commit-real-ssh':'commit-real-native',{rows,independentExpected:expected(f),unchanged:true,boundary:ssh?'Actual encrypted loopback SSH Git; no external host/platform pass. Fixture setup precedes snapshot.':'Actual native Git; root, changed, empty and explicit range reads against dirty index/worktree. Preparation writes precede snapshot.'});
}
test('P0 commit files frozen and current native read real commits parent ranges binary and literal paths without writes',async(t)=>{await real(t,false);});
test('P0 commit files frozen and current SSH read real commits parent ranges binary and literal paths without writes',async(t)=>{await real(t,true);});

test('P0 commit files actual SDK enforces owning resource typed query cancellation and helper isolation',async(t)=>{
  const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository({initial:false});t.after(f.close);setup(f);
  const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(f.root,'state')],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
  try {
    const init=await child.client.initialize(),{resource}=await child.client.registerRepository(f.repo);assert.equal(resource.agentId,init.agentId);
    const before=snapshot(f),result=await child.client.readRepository(resource,'commitFiles',{commit:f.second});assertFiles(result,f);
    assertFiles(await child.client.readRepository(resource,'commitFiles',{commit:f.empty,parentCommit:f.first}),f);
    assert.deepEqual(await child.client.readRepository(resource,'commitFiles',{commit:f.empty}),[]);
    for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}])
      await assert.rejects(child.client.readRepository(foreign,'commitFiles',{commit:f.second}),e=>e.kind==='not-found');
    for(const params of [{commit:f.second,args:['reset','--hard']},{commit:f.second,path:'../outside'},{commit:f.second,file:'binary.dat'},{commit:f.second,parentCommit:3},{commit:''},{commit:'-p'},{commit:'bad\0ref'}])
      await assert.rejects(child.client.request('repositories.read',{resource,kind:'commitFiles',params}),e=>e.kind==='invalid-params');
    for(const helper of ['_parseCommitNameStatus','_parseCommitNumstat','git.commitFiles'])
      await assert.rejects(child.client.request(helper,{}),e=>e.kind==='unknown-method');
    const c=new AbortController();c.abort();await assert.rejects(child.client.readRepository(resource,'commitFiles',{commit:f.second},{signal:c.signal}),e=>e.kind==='cancelled');
    assert.deepEqual(snapshot(f),before);proof('commit-sdk',{resource,result,before,after:snapshot(f),unchanged:true,foreignResourcesRejected:true,extraFieldsAndInvalidRefsRejected:true,helperRPCRejected:true,preAbortedRequestRejected:true,boundary:'Typed current SDK/stdio reads. No extra helper RPC or arbitrary execute query.'});
  } finally {await child.close();}
});
