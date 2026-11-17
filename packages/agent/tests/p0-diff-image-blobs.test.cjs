const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {execFileSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {createRepository}=require('./helpers/local-repository.cjs');
const {startSSHServer}=require('./helpers/ssh-server.cjs');
const {SSHConnection}=require('../dist/adapters/ssh/connection-manager');
const {NativeRepositoryConnection}=require('../dist/adapters/git/native');
const {DiffImages}=require('../dist/modules/git/diff-images');
const {CommandOutputLimitError}=require('../dist/ports/process');
const root=path.resolve(__dirname,'../../..'),baseline='3c05f640fcc1a04c864e47bfc2880483ad48c984',limit=5*1024*1024;
const hash=v=>createHash('sha256').update(v).digest('hex');
const plain=v=>JSON.parse(JSON.stringify(v));
const ok=(stdout='',stdoutBytes)=>({exitCode:0,stdout,stderr:'',...(stdoutBytes===undefined?{}:{stdoutBytes})});
function proof(name,value){if(process.env.P0_DIFF_IMAGE_BLOBS_PROOF_DIR)fs.writeFileSync(path.join(process.env.P0_DIFF_IMAGE_BLOBS_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function frozen(){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  let source=fs.readFileSync(path.join(process.env.P0_DIFF_IMAGE_BLOBS_FROZEN,file),'utf8');
  assert.equal(source,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
  if(file.endsWith('/connection-manager.ts')){
   const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),decl=ast.statements.filter(s=>ts.isClassDeclaration(s)&&s.name?.text==='CommandOutputLimitError');assert.equal(decl.length,1);source=decl[0].getText(ast);
  }
  const module={exports:{}};cache.set(file,module.exports);
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   module,exports:module.exports,Buffer,Error,process,AbortSignal,AbortController,TextDecoder,setTimeout,clearTimeout,
   require(id){
    if(id==='util'||id.startsWith('node:'))return require(id);
    if(id==='@alune/shared')return {...load('packages/shared/src/types/repository.ts'),...load('packages/shared/src/lfs.ts')};
    assert(id.startsWith('./'),'Unexpected runtime dependency '+id);
    return load(path.posix.join(path.posix.dirname(file),id+'.ts'));
   },
  },{filename:file});return module.exports;
 }
 return {Klass:load('packages/ssh-client/src/diff-images.ts').DiffImages,Limit:load('packages/ssh-client/src/connection-manager.ts').CommandOutputLimitError};
}
const versions=()=>{const old=frozen();return [['frozen',old.Klass,old.Limit],['current',DiffImages,CommandOutputLimitError]];};
function scripted(run,connectionSignal){const calls=[];return {calls,connection:{signal:connectionSignal,async execGit(p,args,s,opts){calls.push({path:p,args:[...args],signal:s,options:opts});return run(p,args,s,opts);},withSftp(){throw Error('Unexpected SFTP');}}};}
function expectError(message,statusCode){return e=>{assert.equal(e.message,message);if(statusCode!==undefined)assert.equal(e.statusCode,statusCode);return true;};}
test('P0 image git frozen and current preserve internal argv options results and errors',async()=>{
 const rows=[];
 for(const [version,Klass]of versions()){
  const result=ok(" \0中文\n'\"\\$()",Buffer.from([0,255,128])),s=new AbortController().signal,args=['cat-file','blob',"HEAD:中文 '\"\\\n.png"],before=[...args],f=scripted(()=>result);
  assert.equal(await new Klass(f.connection).git('/repo literal\n',args,s),result);assert.deepEqual(args,before);assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal,s);assert.equal(f.calls[0].options,undefined);assert.deepEqual(f.calls[0].args,args);assert.equal(f.calls[0].path,'/repo literal\n');
  for(const exitCode of [1,128,null]){const r={exitCode,stdout:'keep',stderr:' fatal\n'},x=scripted(()=>r);assert.equal(await new Klass(x.connection).git('/r',['cat-file','-t','bad']),r);}
  const reason=new Error('original transport error'),x=scripted(()=>{throw reason;});await assert.rejects(new Klass(x.connection).git('/r',['cat-file']),e=>e===reason);
  const a=new AbortController(),b=new AbortController(),g=scripted(()=>result,b.signal);await new Klass(g.connection).git('/r',['cat-file'],a.signal);assert.notEqual(g.calls[0].signal,a.signal);b.abort(reason);assert.equal(g.calls[0].signal.reason,reason);
  rows.push({version,path:f.calls[0].path,args,result:{...result,stdoutBytes:result.stdoutBytes.toString('hex')},sameResultObject:true,undefinedOptions:true,nonzeroReturnedUnchanged:true,transportIdentity:true,combinedSignal:true});
 }proof('image-git-matrix',{rows});
});
test('P0 image revisions frozen and current map every side staging and explicit parent without mutation',()=>{
 const rows=[];
 for(const [version,Klass]of versions())for(const side of ['before','after'])for(const staged of [false,true])for(const commit of [undefined,'abc123'])for(const parentCommit of [undefined,'parent456']){
  const options={file:"中文 ' $()\\\n.png",side,staged,...commit?{commit}:{},...parentCommit?{parentCommit}:{}},before=plain(options),f=scripted(()=>{throw Error('No transport for revisions');});Object.freeze(options);
  const expected=commit?{blob:`${side==='after'?commit:(parentCommit||commit+'^')}:${options.file}`,worktree:false}:staged?{blob:`${side==='after'?':0':'HEAD'}:${options.file}`,worktree:false}:side==='after'?{blob:null,worktree:true}:{blob:':0:'+options.file,worktree:false};
  const actual=plain(new Klass(f.connection).revisions(options));assert.deepEqual(actual,expected);assert.deepEqual(options,before);assert.equal(f.calls.length,0);rows.push({version,options,expected,actual,transportCalls:0});
 }proof('image-revisions-matrix',{rows});
});
test('P0 image blobs frozen and current enforce binary limits and exact failure short circuits',async()=>{
 const rows=[],tooLarge='图片超出预览限制（5 MiB），请在仓库中查看。';
 for(const [version,Klass,Limit]of versions()){
  for(const bytes of [Buffer.alloc(0),Buffer.from([0,255,254,128,10,13]),Buffer.alloc(limit,0xff)]){
   const s=new AbortController().signal,f=scripted((p,args)=>args[1]==='-t'?ok(' blob\n'):args[1]==='-s'?ok(String(bytes.length)+'\n'):ok('',bytes)),api=new Klass(f.connection),actual=await api.readBlob('/repo',"HEAD:literal\n.png",s);
   assert.equal(actual,bytes);assert.deepEqual(f.calls.map(c=>c.args),[['cat-file','-t',"HEAD:literal\n.png"],['cat-file','-s',"HEAD:literal\n.png"],['cat-file','blob',"HEAD:literal\n.png"]]);assert(f.calls.every(c=>c.path==='/repo'&&c.signal===s));assert.equal(f.calls[0].options,undefined);assert.equal(f.calls[1].options,undefined);assert.deepEqual(plain(f.calls[2].options),{maxOutputBytes:limit,binary:true});rows.push({version,label:'success',bytes:bytes.length,sha256:hash(actual),calls:f.calls.map(c=>({...c,signal:'caller'}))});
  }
  const cases=[
   ['absent type',1,{exitCode:128,stdout:'',stderr:'private'},'此版本没有该图片。',404],
   ['nonblob',1,ok('tree\n'),'此路径不是可预览的文件。',400],
   ['absent size',2,{exitCode:null,stdout:'',stderr:'private'},'此版本没有该图片。',404],
   ['oversize metadata',2,ok(String(limit+1)),tooLarge,400],
   ['blob exit',3,{exitCode:128,stdout:'',stderr:'  fatal read\n'},'无法读取图片：fatal read',400],
   ['empty stderr',3,{exitCode:null,stdout:'',stderr:' \n'},'无法读取图片：远端 Git 命令失败，请刷新后重试。',400],
  ];
  for(const [label,at,value,message,status]of cases){const f=scripted(()=>f.calls.length===at?value:ok(f.calls.length===1?'blob':'1'));await assert.rejects(new Klass(f.connection).readBlob('/r','spec'),expectError(message,status));assert.equal(f.calls.length,at);rows.push({version,label,dispatches:at,message,status});}
  for(const at of [1,2,3]){const reason=new Error('transport '+at),f=scripted(()=>{if(f.calls.length===at)throw reason;return ok(f.calls.length===1?'blob':'1');});await assert.rejects(new Klass(f.connection).readBlob('/r','spec'),e=>e===reason);assert.equal(f.calls.length,at);rows.push({version,label:'transport identity',at});}
  for(const at of [1,2,3]){const reason=new Limit(),f=scripted(()=>{if(f.calls.length===at)throw reason;return ok(f.calls.length===1?'blob':'1');});await assert.rejects(new Klass(f.connection).readBlob('/r','spec'),at===3?expectError(tooLarge,400):e=>e===reason);rows.push({version,label:'limit exception',at,mapped:at===3});}
  const f=scripted(()=>ok('blob'));assert.deepEqual(await new Klass(f.connection).readBlob('/r','spec'),Buffer.alloc(0));rows.push({version,label:'undefined stdoutBytes returns empty',dispatches:f.calls.length});
 }proof('image-blob-matrix',{rows,limit,boundary:'Exact private helper behavior including absent byte fallback; real transport boundary tested separately, no claim of public arbitrary spec authorization.'});
});
test('P0 image helpers frozen and current cancel before each Git dispatch and preserve transport reasons',async()=>{
 const rows=[];
 for(const [version,Klass]of versions())for(const method of ['git','readBlob'])for(const source of ['caller','connection']){
  const a=new AbortController(),b=new AbortController(),reason=new Error('preabort '+source);(source==='caller'?a:b).abort(reason);const f=scripted(()=>ok('blob'),b.signal),api=new Klass(f.connection);await assert.rejects(method==='git'?api.git('/r',['cat-file'],a.signal):api.readBlob('/r','spec',a.signal),e=>e===reason);assert.equal(f.calls.length,0);rows.push({version,method,source,phase:'preabort',dispatches:0});
 }
 for(const [version,Klass]of versions())for(const at of [1,2])for(const source of ['caller','connection']){
  const a=new AbortController(),b=new AbortController(),reason=new Error('after '+at),f=scripted(()=>{if(f.calls.length===at)(source==='caller'?a:b).abort(reason);return ok(f.calls.length===1?'blob':'1');},b.signal);await assert.rejects(new Klass(f.connection).readBlob('/r','spec',a.signal),e=>e===reason);assert.equal(f.calls.length,at);rows.push({version,source,phase:'after metadata',at,dispatches:at});
 }
 for(const [version,Klass]of versions()){
  const a=new AbortController(),reason=new Error('controlled inflight'),f=scripted((p,args,s)=>new Promise((resolve,reject)=>{s.addEventListener('abort',()=>reject(s.reason),{once:true});queueMicrotask(()=>a.abort(reason));}));await assert.rejects(new Klass(f.connection).readBlob('/r','spec',a.signal),e=>e===reason);assert.equal(f.calls.length,1);rows.push({version,phase:'controlled inflight',dispatches:1});
 }proof('image-cancellation',{rows,boundary:'Metadata dispatch boundaries and controlled transport rejection; no real inflight kill or SDK midflight image cancellation claim.'});
});
function snapshot(directory){const files={},links={},modes={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name),r=path.relative(directory,p);modes[r]=fs.lstatSync(p).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile())files[r]=hash(fs.readFileSync(p));}}walk(directory);return {files,links,modes};}
function fixture(){const f=createRepository(),file="图 '\"$()\\\n.png",before=Buffer.from([137,80,78,71,0,255,254]),after=Buffer.from([0,255,128,13,10,11]),working=Buffer.from([255,0,10,12]);f.write(file,before);f.git('add','--',file);f.git('commit','-qm','image before');const parent=f.git('rev-parse','HEAD').trim();f.write(file,after);f.git('add','--',file);f.git('commit','-qm','image after');const commit=f.git('rev-parse','HEAD').trim();f.write(file,Buffer.from([42,0,255]));f.git('add','--',file);const index=Buffer.from([42,0,255]);f.write(file,working);return {...f,file,before,after,working,index,parent,commit};}
function adapt(connection,Limit){return {get signal(){return connection.signal;},async execGit(...args){try{return await connection.execGit(...args);}catch(e){if(e instanceof CommandOutputLimitError&&Limit!==CommandOutputLimitError)throw new Limit();throw e;}},withSftp:run=>connection.withSftp(run)};}
async function real(t,ssh){
 const f=fixture();t.after(f.close);let connection,remote;if(ssh){remote=await startSSHServer();t.after(()=>remote.close());connection=new SSHConnection(remote.options);connection.on('error',()=>{});await connection.connect();t.after(()=>connection.disconnect());}else{connection=new NativeRepositoryConnection();t.after(()=>connection.close());}
 const objects=[['empty',Buffer.alloc(0)],['exact',Buffer.alloc(limit,0xff)],['overflow',Buffer.alloc(limit+1,0xff)]].map(([label,bytes])=>({label,bytes,oid:execFileSync('git',['-C',f.repo,'hash-object','-w','--stdin'],{input:bytes,encoding:'utf8'}).trim()}));
 const before=snapshot(f.root),rows=[],limits=[];
 const cases=[{side:'before',commit:f.commit},{side:'before',commit:f.commit,parentCommit:f.parent},{side:'after',commit:f.commit},{side:'before',staged:true},{side:'after',staged:true},{side:'before'},{side:'after'}];
 for(const [version,Klass,Limit]of versions()){
  const api=new Klass(adapt(connection,Limit));
  for(const params of cases){const options={file:f.file,...params},selection=plain(api.revisions(options));const expected=selection.worktree?fs.readFileSync(path.join(f.repo,f.file)):execFileSync('git',['-C',f.repo,'cat-file','blob',selection.blob]);const dto=plain(await api.read(f.repo,options));assert.equal(dto.path,f.file);assert.equal(dto.side,options.side);assert.equal(dto.mediaType,'image/png');assert.equal(dto.byteLength,expected.length);assert.deepEqual(Buffer.from(dto.content,'base64'),expected);assert.deepEqual(snapshot(f.root),before);rows.push({version,options,selection,expectedSha256:hash(expected),dto});}
  for(const item of objects){let outcome;if(item.label==='overflow'){await assert.rejects(api.readBlob(f.repo,item.oid),expectError('图片超出预览限制（5 MiB），请在仓库中查看。',400));outcome='limit rejection';}else{const bytes=await api.readBlob(f.repo,item.oid);assert.deepEqual(bytes,item.bytes);outcome=hash(bytes);}assert.deepEqual(snapshot(f.root),before);limits.push({version,label:item.label,oid:item.oid,byteLength:item.bytes.length,outcome});
   if(item.label==='overflow'){
    const trace=[],base=adapt(connection,Limit),underreported={...base,async execGit(p,args,signal,options){trace.push({args:[...args],options});const result=await base.execGit(p,args,signal,options);return args[0]==='cat-file'&&args[1]==='-s'?{...result,stdout:String(limit)}:result;}};
    await assert.rejects(new Klass(underreported).readBlob(f.repo,item.oid),expectError('图片超出预览限制（5 MiB），请在仓库中查看。',400));assert.equal(trace.length,3);assert.deepEqual(plain(trace[2].options),{maxOutputBytes:limit,binary:true});assert.deepEqual(snapshot(f.root),before);limits.push({version,label:'actual transport overflow with underreported metadata',oid:item.oid,byteLength:item.bytes.length,trace,outcome:'limit rejection',boundary:'Only cat-file size stdout is underreported to exercise actual native/SSH byte-stream guard; original helper and real blob command execute unchanged.'});
   }}
  await assert.rejects(api.readBlob(f.repo,'HEAD:missing.png'),expectError('此版本没有该图片。',404));await assert.rejects(api.readBlob(f.repo,'HEAD'),expectError('此路径不是可预览的文件。',400));
  const a=new AbortController(),reason=new Error('real preabort');a.abort(reason);await assert.rejects(api.readBlob(f.repo,f.commit+':'+f.file,a.signal),e=>e===reason);
 }
 assert.deepEqual(snapshot(f.root),before);proof(ssh?'image-real-ssh':'image-real-native',{rows,limits,before,after:snapshot(f.root),missingRejected:true,commitObjectRejected:true,realPreabort:true,boundary:'Real current native/encrypted loopback SSH transport for both helper versions. Whole fixture prepared before byte/mode/link snapshot. Binary bytes independent git cat-file, no LFS download or write.'});
}
test('P0 image blobs frozen and current real native match independent Git bytes and remain readonly',async t=>real(t,false));
test('P0 image blobs frozen and current real SSH match independent Git bytes and remain readonly',async t=>real(t,true));
test('P0 image SDK returns owning bytes isolates resources and exposes no internal helper RPC',async t=>{
 const {spawnAgent}=require('@alune/agent-client/node'),f=fixture(),other=fixture();t.after(f.close);t.after(other.close);other.write(other.file,Buffer.from([23,34]));
 const state=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'alune-b44-sdk-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
 const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),state],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
 const native=new NativeRepositoryConnection();t.after(()=>native.close());
 try{
  const init=await child.client.initialize(),resource=(await child.client.registerRepository(f.repo)).resource,otherResource=(await child.client.registerRepository(other.repo)).resource;assert.equal(resource.agentId,init.agentId);const before=snapshot(f.root),otherBefore=snapshot(other.root),rows=[];
  for(const params of [{side:'before'},{side:'after'},{side:'before',staged:true},{side:'after',staged:true},{side:'before',commit:f.commit},{side:'after',commit:f.commit},{side:'before',commit:f.commit,parentCommit:f.parent}]){const options={file:f.file,...params},expected=plain(await new DiffImages(native).read(f.repo,options)),actual=await child.client.readRepository(resource,'diffImage',options);assert.deepEqual(actual,expected);rows.push({options,actual});}
  const second=await child.client.readRepository(otherResource,'diffImage',{file:other.file,side:'after'});assert.deepEqual(Buffer.from(second.content,'base64'),Buffer.from([23,34]));
  for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}])await assert.rejects(child.client.readRepository(foreign,'diffImage',{file:f.file,side:'after'}),e=>e.kind==='not-found');
  for(const params of [{file:f.file,side:'after',path:other.repo},{file:'../escape.png',side:'after'},{file:'.git/config.png',side:'after'},{file:f.file,side:'wrong'},{file:f.file,side:'before',commit:'--help'}])await assert.rejects(child.client.request('repositories.read',{resource,kind:'diffImage',params}),e=>e.kind==='invalid-params');
  for(const method of ['diffImages.git','diffImages.revisions','diffImages.readBlob','git.execute'])await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');
  const a=new AbortController();a.abort();await assert.rejects(child.client.readRepository(resource,'diffImage',{file:f.file,side:'before'},{signal:a.signal}),e=>e.kind==='cancelled');
  assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);proof('image-sdk',{resource,otherResource,rows,second,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),foreignRejected:true,strictParams:true,preabort:true,helperRpcAbsent:true,boundary:'Actual current stdio SDK diffImage consumer; no internal helper RPC, no SDK inflight cancellation claim. Separate mutation companions cover unknown/no replay.'});
 }finally{await child.close();}
});
