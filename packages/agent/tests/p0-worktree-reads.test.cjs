const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createRepository } = require('./helpers/local-repository.cjs');
const { startSSHServer } = require('./helpers/ssh-server.cjs');
const { SSHConnection } = require('../dist/adapters/ssh/connection-manager');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { GitWorktrees } = require('../dist/modules/git/worktrees');
const { CommandOutputLimitError } = require('../dist/ports/process');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
const limit = 1024 * 1024;
const options = {maxOutputBytes:limit,strictUtf8:true};
const plain = v => JSON.parse(JSON.stringify(v));
const sig = () => new AbortController().signal;
function proof(name,value) {
  if(process.env.P0_WORKTREE_READS_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_WORKTREE_READS_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
function frozen() {
  const cache=new Map();
  function load(name) {
    if(cache.has(name))return cache.get(name);
    const file='packages/ssh-client/src/'+name+'.ts',source=fs.readFileSync(path.join(process.env.P0_WORKTREE_READS_FROZEN,file),'utf8');
    assert.equal(source,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
    const module={exports:{}};cache.set(name,module.exports);
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
      module,exports:module.exports,Buffer,Error,process,AbortSignal,AbortController,
      require(id){
        if(id.startsWith('node:')||id==='util')return require(id);
        assert(['worktrees','repository-path','repository-transport','git-shell'].some(n=>id==='./'+n),'Unexpected frozen runtime import '+id);
        return load(id.slice(2));
      },
    },{filename:file});
    return module.exports;
  }
  return load('worktrees').GitWorktrees;
}
const versions=()=>[['frozen',frozen()],['current',GitWorktrees]];
function scripted(git,realpath=(p,cb)=>cb(null,p),connectionSignal) {
  const calls=[],paths=[];
  return {calls,paths,connection:{signal:connectionSignal,
    async execGit(p,args,s,opts){calls.push({path:p,args:plain(args),signal:s,options:plain(opts)});return git(p,args,s,opts);},
    withSftp(run){return run({realpath(p,cb){paths.push(p);realpath(p,cb);}});},
  }};
}
const ok=stdout=>({exitCode:0,stdout,stderr:''});
const msg=message=>e=>{assert.equal(e.message,message);return true;};
test('P0 worktree reads frozen and current preserve exact argv output limits errors and signals',async()=>{
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const text of [''," \n中文\0'\"$()\\\t\n",'é'.repeat(limit/2)]) {
      const args=['worktree','list','--porcelain','-z','--',"literal '\"$()\\\n"],before=[...args],s=sig(),f=scripted(()=>ok(text));
      assert.equal(await new Klass(f.connection).read('/literal repo\n',args,s),text);
      assert.deepEqual(args,before);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/literal repo\n');assert.deepEqual(f.calls[0].args,args);assert.equal(f.calls[0].signal,s);assert.deepEqual(f.calls[0].options,options);assert.deepEqual(f.paths,[]);
      rows.push({version,bytes:Buffer.byteLength(text),sha256:hash(text),call:{...f.calls[0],signal:'same caller signal'}});
    }
    for(const [exitCode,stderr] of [[1,''],[128,'fatal\n'],[null,'permission denied']]) {
      const f=scripted(()=>({exitCode,stdout:'not success',stderr})),error='无法读取 Worktree：'+(stderr||'目录不存在、不可访问或不是 Git 仓库。');
      await assert.rejects(new Klass(f.connection).read('/repo',['worktree','list']),msg(error));assert.equal(f.calls.length,1);
      rows.push({version,exitCode,stderr,error});
    }
    for(const reason of [new Error('transport failed'),new CommandOutputLimitError(),new TypeError('invalid UTF8')]) {
      const f=scripted(()=>{throw reason;});await assert.rejects(new Klass(f.connection).read('/repo',['rev-parse','--show-toplevel']),e=>e===reason);assert.equal(f.calls.length,1);
      rows.push({version,error:reason.message,identityPreserved:true});
    }
    const a=new AbortController(),b=new AbortController(),f=scripted(()=>ok('yes'),undefined,b.signal);assert.equal(await new Klass(f.connection).read('/repo',['worktree','list'],a.signal),'yes');
    const combined=f.calls[0].signal;assert.notEqual(combined,a.signal);assert.notEqual(combined,b.signal);const reason=new Error('connection signal');b.abort(reason);assert.equal(combined.reason,reason);
    rows.push({version,combinedSignal:true});
  }
  proof('worktree-read-matrix',{rows,options,boundary:'Private internal typed args, no generic Git RPC or argv authorization claim; transport errors retain identity. Real byte-limit/UTF8 enforcement is tested separately.'});
});
test('P0 worktree root frozen and current resolve bare nonbare literal and drive paths and errors',async()=>{
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const [bare,input,output,canonical,expected] of [
      ['true\n','/bare\n',null,'/bare canonical\n','/bare canonical\n'],
      [' true \r\n','/bare',null,'/bare','/bare'],
      ['false\n','/repo/sub',"/literal 中文 '\"$()\\\n\n","/literal 中文 '\"$()\\\n","/literal 中文 '\"$()\\\n"],
      ['false\r\n','/alias','/root\r\n','/root','/root'],
      ['false','/alias','/root','/C:/工作 区','C:/工作 区'],
      ['false','/alias','/root','\\\\server\\share\\repo','\\\\server\\share\\repo'],
    ]) {
      const f=scripted((p,args)=>ok(args[1]==='--is-bare-repository'?bare:output),(p,cb)=>cb(null,canonical)),s=sig();
      const result=await new Klass(f.connection).root(input,s);assert.equal(result,expected);
      const isBare=bare.trim()==='true';assert.deepEqual(f.calls.map(c=>c.args),[['rev-parse','--is-bare-repository'],...isBare?[]:[['rev-parse','--show-toplevel']]]);
      for(const c of f.calls){assert.equal(c.path,input);assert.equal(c.signal,s);assert.deepEqual(c.options,options);}
      assert.deepEqual(f.paths,[isBare?input:output.replace(/\r?\n$/,'')]);
      rows.push({version,bare,input,output,canonical,result,calls:f.calls.map(c=>({...c,signal:'caller'})),paths:f.paths});
    }
    for(const at of [1,2]) {
      const f=scripted(()=>f.calls.length===at?{exitCode:128,stdout:'',stderr:'denied'}:ok('false\n'));
      await assert.rejects(new Klass(f.connection).root('/repo',sig()),msg('无法读取 Worktree：denied'));assert.equal(f.calls.length,at);assert.deepEqual(f.paths,[]);
      rows.push({version,failureAtRead:at,realpathCalls:0});
    }
    for(const [code,message] of [[2,'目录不存在或已移走，请刷新列表。'],['ENOENT','目录不存在或已移走，请刷新列表。'],[3,'没有读取此目录的权限。'],['EACCES','没有读取此目录的权限。']]) {
      const error=Object.assign(new Error('sftp fixture'),{code}),f=scripted(()=>ok('true\n'),(p,cb)=>cb(error));
      await assert.rejects(new Klass(f.connection).root('/bare',sig()),msg(message));assert.equal(f.calls.length,1);assert.equal(f.paths.length,1);rows.push({version,code,message});
    }
    const reason=new Error('unknown SFTP error'),f=scripted(()=>ok('true\n'),(p,cb)=>cb(reason));await assert.rejects(new Klass(f.connection).root('/bare',sig()),e=>e===reason);
    rows.push({version,unknownSftpIdentity:true});
  }
  proof('worktree-root-matrix',{rows,boundary:'Synthetic Windows/UNC spelling only; real native/SSH roots separately tested. Strip exactly one trailing command line ending, preserve literal path whitespace/newline.'});
});
test('P0 worktree read and root cancel before dispatch after reads and during canonicalization',async()=>{
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const method of ['read','root'])for(const source of ['caller','connection']) {
      const a=new AbortController(),b=new AbortController(),reason=new Error(method+' '+source+' preabort');(source==='caller'?a:b).abort(reason);
      const f=scripted(()=>ok('true\n'),undefined,b.signal),helper=new Klass(f.connection);
      await assert.rejects(method==='read'?helper.read('/repo',['rev-parse','--is-bare-repository'],a.signal):helper.root('/repo',a.signal),e=>e===reason);assert.equal(f.calls.length,0);assert.equal(f.paths.length,0);rows.push({version,method,source,phase:'preabort',dispatches:0,realpaths:0});
    }
    for(const method of ['read','root']) {
      const a=new AbortController(),reason=new Error('after read'),f=scripted(()=>{a.abort(reason);return {exitCode:128,stdout:'true\n',stderr:'must not override cancel'};}),helper=new Klass(f.connection);
      await assert.rejects(method==='read'?helper.read('/repo',['rev-parse'],a.signal):helper.root('/repo',a.signal),e=>e===reason);assert.equal(f.calls.length,1);assert.equal(f.paths.length,0);rows.push({version,method,phase:'after read',dispatches:1,realpaths:0});
    }
    const a=new AbortController(),reason=new Error('in flight transport'),f=scripted((p,args,s)=>new Promise((resolve,reject)=>{s.addEventListener('abort',()=>reject(s.reason),{once:true});queueMicrotask(()=>a.abort(reason));}));
    await assert.rejects(new Klass(f.connection).read('/repo',['rev-parse'],a.signal),e=>e===reason);assert.equal(f.calls.length,1);rows.push({version,phase:'controlled in flight transport',dispatches:1});
    for(const fails of [false,true]) {
      const a=new AbortController(),reason=new Error('realpath cancellation'),f=scripted(()=>ok('true\n'),(p,cb)=>queueMicrotask(()=>{a.abort(reason);cb(fails?Object.assign(new Error('missing'),{code:2}):null,p);}));
      await assert.rejects(new Klass(f.connection).root('/bare',a.signal),e=>e===reason);assert.equal(f.calls.length,1);assert.equal(f.paths.length,1);rows.push({version,phase:'during realpath',sftpError:fails,originalReason:true});
    }
  }
  proof('worktree-cancellation',{rows,boundary:'Controlled transport and SFTP cancellation plus real preabort; no real remote process-tree kill claim.'});
});
function snapshot(directory) {
  const files={},links={},modes={};
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const p=path.join(d,e.name),r=path.relative(directory,p);modes[r]=fs.lstatSync(p).mode;
    if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile())files[r]=hash(fs.readFileSync(p));
  }}walk(directory);return {files,links,modes};
}
function at(directory,...args){return execFileSync('git',['--literal-pathspecs','-C',directory,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});}
async function real(t,ssh) {
  const f=createRepository(),u=createRepository({initial:false}),connections=[];let remote;
  t.after(async()=>{for(const c of connections.reverse())await c();f.close();u.close();});
  const main=path.join(f.root,"主仓库 '\"$()\\\n");fs.renameSync(f.repo,main);
  const linked=path.join(f.root,"linked 中文 '$()\n"),detached=path.join(f.root,'detached'),bare=path.join(f.root,'bare.git'),alias=path.join(f.root,'alias'),sub=path.join(main,'sub');
  at(main,'worktree','add','-qb','feature/p0',linked);at(main,'worktree','add','-q','--detach',detached);at(main,'clone','-q','--bare',main,bare);fs.symlinkSync(main,alias);fs.mkdirSync(sub);
  let connection;
  if(ssh){remote=await startSSHServer();connections.push(()=>remote.close());connection=new SSHConnection(remote.options);connection.on('error',()=>{});connections.push(()=>connection.disconnect());await connection.connect();}
  else {connection=new NativeRepositoryConnection();connections.push(()=>connection.close());}
  const large=[['exact','é'.repeat(limit/2)],['overflow','é'.repeat(limit/2)+'a'],['invalid',Buffer.from([0xff,0xfe])]].map(([label,bytes])=>{const p=path.join(main,label);fs.writeFileSync(p,bytes);return {label,oid:at(main,'hash-object','-w','--',p).trim(),bytes:Buffer.byteLength(bytes)};});
  const before=snapshot(f.root),unbornBefore=snapshot(u.root),rows=[],limits=[];
  for(const directory of [main,linked,detached,bare,alias,sub,u.repo]) {
    const isBare=at(directory,'rev-parse','--is-bare-repository').trim()==='true',independent=fs.realpathSync(isBare?directory:at(directory,'rev-parse','--show-toplevel').replace(/\r?\n$/,'')),catalog=at(directory,'worktree','list','--porcelain','-z'),results=[];
    for(const [version,Klass] of versions()) {
      const helper=new Klass(connection),s=sig(),actual=await helper.root(directory,s),raw=await helper.read(directory,['worktree','list','--porcelain','-z'],s);assert.equal(actual,independent);assert.equal(raw,catalog);
      const items=plain(await helper.list(directory,s));assert.equal(items.filter(i=>i.isCurrent).length,1);assert.equal(items.find(i=>i.isCurrent).path,independent);
      assert.equal(await helper.kind(directory,s),directory===linked||directory===detached?'linked':'main');
      if(!isBare)assert.equal(await helper.resolve(directory,independent,s),independent);
      else await assert.rejects(helper.resolve(directory,independent,s),/裸仓库/);
      assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(u.root),unbornBefore);
      results.push({version,root:actual,rawSha256:hash(raw),items});
    }
    rows.push({directory,isBare,independentRoot:independent,independentRaw:catalog,independentRawSha256:hash(catalog),results});
  }
  for(const item of large)for(const [version,Klass] of versions()) {
    const helper=new Klass(connection);let error=null;
    if(item.label==='exact'){const text=await helper.read(main,['cat-file','blob',item.oid],sig());assert.equal(Buffer.byteLength(text),limit);assert.equal(text,'é'.repeat(limit/2));}
    else await assert.rejects(helper.read(main,['cat-file','blob',item.oid],sig()),e=>{error={name:e.name,message:e.message};if(item.label==='overflow')assert(e instanceof CommandOutputLimitError);else assert(e instanceof TypeError);return true;});
    limits.push({version,...item,error});assert.deepEqual(snapshot(f.root),before);
  }
  const absent=path.join(f.root,'absent'),nongit=path.join(f.root,'nongit');fs.mkdirSync(nongit);const failuresBefore=snapshot(f.root),failures=[];
  for(const directory of [absent,nongit])for(const [version,Klass] of versions()) {
    let error;await assert.rejects(new Klass(connection).root(directory,sig()),e=>{assert.match(e.message,/无法读取 Worktree：/);error=e.message;return true;});failures.push({version,directory,error});assert.deepEqual(snapshot(f.root),failuresBefore);
  }
  const a=new AbortController(),reason=new Error('real preabort');a.abort(reason);
  for(const [,Klass] of versions()){await assert.rejects(new Klass(connection).root(main,a.signal),e=>e===reason);await assert.rejects(new Klass(connection).read(main,['rev-parse'],a.signal),e=>e===reason);}
  assert.deepEqual(snapshot(f.root),failuresBefore);
  proof(ssh?'worktree-real-ssh':'worktree-real-native',{rows,limits,failures,before,afterMeasured:snapshot(f.root),unbornBefore,unbornAfter:snapshot(u.root),failuresBefore,measuredReadsUnchanged:true,preabort:true,boundary:'Temporary fixture creation and nongit mkdir occur outside read snapshot intervals. Complete fixture-root ordinary files including HEAD refs indexes worktree metadata plus modes/symlinks are compared during each interval. Encrypted loopback SSH or current Mac native only, independent Git outputs; not a deployed remote Agent.'});
}
test('P0 worktree helpers frozen and current real native match independent Git roots without writes',async t=>real(t,false));
test('P0 worktree helpers frozen and current real SSH match independent Git roots without writes',async t=>real(t,true));
test('P0 worktree helpers current SDK isolates catalogs rejects foreign resources and exposes no helper RPC',async t=>{
  const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);
  const linked=path.join(f.root,"SDK linked 中文 '$()\n");f.git('worktree','add','-qb','sdk/linked',linked);
  const state=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'alune-b43-sdk-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
  const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),state],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
  try {
    const init=await child.client.initialize(),resource=(await child.client.registerRepository(f.repo)).resource,otherResource=(await child.client.registerRepository(other.repo)).resource;
    assert.equal(resource.agentId,init.agentId);const before=snapshot(f.root),otherBefore=snapshot(other.root);
    const first=await child.client.readRepository(resource,'worktrees',{}),second=await child.client.readRepository(otherResource,'worktrees',{});
    assert.equal(first.length,2);assert.equal(second.length,1);assert.equal(first.filter(i=>i.isCurrent).length,1);assert.equal(second.filter(i=>i.isCurrent).length,1);assert(first.some(i=>i.path===fs.realpathSync(linked)));assert(first.every(i=>i.path!==fs.realpathSync(other.repo)));assert(second.every(i=>i.path!==fs.realpathSync(f.repo)));
    for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}])await assert.rejects(child.client.readRepository(foreign,'worktrees',{}),e=>e.kind==='not-found');
    for(const params of [{path:other.repo},{args:['reset','--hard']},{signal:'bad'}])await assert.rejects(child.client.request('repositories.read',{resource,kind:'worktrees',params}),e=>e.kind==='invalid-params');
    for(const method of ['worktrees.read','worktrees.root','GitWorktrees.read','GitWorktrees.root','git.execute'])await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');
    const a=new AbortController();a.abort();await assert.rejects(child.client.readRepository(resource,'worktrees',{}, {signal:a.signal}),e=>e.kind==='cancelled');
    assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);
    proof('worktree-sdk',{resource,otherResource,first,second,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),foreignRejected:true,strictParams:true,preabort:true,helperRpcAbsent:true,boundary:'Actual current SDK/stdio worktrees query consumer only, private root/read not exposed as RPC. Separate mutation companions cover durable unknown/no replay.'});
  } finally {await child.close();}
});
