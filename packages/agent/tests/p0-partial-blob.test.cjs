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
const {NativeRepositoryConnection}=require('../dist/adapters/git/native');
const {SSHConnection}=require('../dist/adapters/ssh/connection-manager');
const {PartialReads}=require('../dist/modules/git/partial-changes');
const {CommandOutputLimitError}=require('../dist/ports/process');
const root=path.resolve(__dirname,'../../..'),baseline='3c05f640fcc1a04c864e47bfc2880483ad48c984',limit=2*1024*1024;
const hash=v=>createHash('sha256').update(v).digest('hex');
const plain=v=>JSON.parse(JSON.stringify(v));
const compact=v=>({bytes:Buffer.byteLength(v),sha256:hash(v),...(v.length<256?{text:v}:{})});
function proof(name,value){if(process.env.P0_PARTIAL_BLOB_PROOF_DIR)fs.writeFileSync(path.join(process.env.P0_PARTIAL_BLOB_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
let old;
function frozen(){
 if(old)return old;
 const file='packages/ssh-client/src/partial-changes.ts',base=process.env.P0_PARTIAL_BLOB_FROZEN;
 const source=fs.readFileSync(path.join(base,file),'utf8');
 assert.equal(source,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),parts=[],inventory=[];
 const record=(name,s)=>{parts.push(s.getText(ast));inventory.push({name,line:ast.getLineAndCharacterOfPosition(s.getStart(ast)).line+1,sha256:hash(s.getText(ast))});};
 for(const name of ['MAX_BYTES','PartialChangesError','stale','Unsupported']){
  const matches=ast.statements.filter(s=>s.name?.text===name||ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)===name));assert.equal(matches.length,1,name);record(name,matches[0]);
 }
 const klass=ast.statements.find(s=>ts.isClassDeclaration(s)&&s.name.text==='PartialChanges'),methods=[];
 for(const name of ['constructor','git','decode','blob']){
  const matches=klass.members.filter(s=>name==='constructor'?ts.isConstructorDeclaration(s):s.name?.getText(ast)===name);assert.equal(matches.length,1,name);
  const s=matches[0];methods.push(s.getText(ast));inventory.push({name:'PartialChanges.'+name,line:ast.getLineAndCharacterOfPosition(s.getStart(ast)).line+1,sha256:hash(s.getText(ast))});
 }
 parts.push('export class FrozenReads { '+methods.join('\n')+' }');
 const modules={};
 function execute(src,filename){const m={exports:{}};vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>{assert(Object.hasOwn(modules,n),'Unreviewed frozen dependency '+n);return modules[n];},Buffer,Error,TextDecoder,AbortSignal},{filename});return m.exports;}
 const dependencies=[];
 for(const name of ['git-shell','repository-transport']){
  const f='packages/ssh-client/src/'+name+'.ts',src=fs.readFileSync(path.join(base,f),'utf8');assert.equal(src,execFileSync('git',['show',baseline+':'+f],{cwd:root,encoding:'utf8'}));modules['./'+name]=execute(src,f);dependencies.push({file:f,sha256:hash(src)});
 }
 old=execute("import {runGit} from './repository-transport';\n"+parts.join('\n'),file).FrozenReads;
 proof('blob-frozen-extraction',{baseline,file,inventory,dependencies,boundary:'Exact unchanged original constructor/git/decode/blob AST members plus lexical dependencies. Full original runGit/git-shell modules, no old SSH executor or full enclosing read/snapshot/apply equivalence claim.'});return old;
}
const versions=()=>[['frozen',frozen()],['current',PartialReads]];
const result=(stdout='',exitCode=0,stderr='')=>({stdout,exitCode,stderr});
test('P0 partial git frozen and current preserve options stdout errors and preabort dispatch boundaries',async()=>{
 const rows=[];
 for(const [version,K]of versions()){
  const calls=[],controller=new AbortController(),args=Object.freeze(['cat-file','-s','a'.repeat(40)]),repo="/tmp/中文 '\"$()\\\n";
  let answer=result('\ufeff中文\r\n\0tail');
  const connection={signal:controller.signal,async execGit(r,a,s,o){calls.push({root:r,args:plain(a),signal:s,options:o});return answer;}};
  const api=new K(connection),actual=await api.git(repo,args);assert.equal(actual,answer.stdout);assert.equal(calls.length,1);assert.equal(calls[0].root,repo);assert.deepEqual(calls[0].args,[...args]);assert.equal(calls[0].signal,controller.signal);assert.deepEqual(plain(calls[0].options),{maxOutputBytes:8*limit,strictUtf8:true});
  rows.push({version,label:'defaults',root:repo,args:[...args],options:plain(calls[0].options),stdout:compact(actual)});
  const stdin=Buffer.from('stdin\0bytes'),onStdout=()=>{},onStderr=()=>{},environment=Object.freeze({P0_BLOB_TEST:'a\nb'}),options=Object.freeze({stdin,binary:true,maxOutputBytes:17,strictUtf8:false,onStdout,onStderr,environment});
  await api.git(repo,args,options);const forwarded=calls.at(-1).options;for(const k of Object.keys(options))assert.equal(forwarded[k],options[k]);assert.equal(Object.keys(forwarded).length,Object.keys(options).length);rows.push({version,label:'explicit options',maxOutputBytes:forwarded.maxOutputBytes,strictUtf8:forwarded.strictUtf8,binary:forwarded.binary,bufferAndCallbacksSame:true,callerOptionsUnchanged:true});
  for(const [exitCode,stderr,message]of [[1,'  fatal: exact\n','fatal: exact'],[128,' \n\t','无法读取 Git 状态。'],[null,'killed','killed']]){answer=result('discard stdout',exitCode,stderr);await assert.rejects(api.git(repo,args),e=>e.statusCode===400&&e.message===message);rows.push({version,label:'nonzero',exitCode,stderr,message,statusCode:400});}
  const failure=new CommandOutputLimitError(),throwing=new K({async execGit(){throw failure;}});await assert.rejects(throwing.git(repo,args),e=>e===failure);rows.push({version,label:'transport rejection identity',message:failure.message});
  controller.abort(failure);const before=calls.length;await assert.rejects(api.git(repo,args),e=>e===failure);assert.equal(calls.length,before);rows.push({version,label:'preabort',dispatches:0});
 }
 proof('blob-git-matrix',{rows,limit,boundary:'Read-only cat-file wrapper. No arbitrary Git RPC, no mutation retry claim; exact frozen runGit/current production runGit with controlled transport.'});
});
test('P0 partial blob frozen and current validate modes OID cache binary limits stale and failed reads',async()=>{
 const rows=[],oid='a'.repeat(40),entry=(mode='100644',id=oid)=>mode+' blob '+id+'\tignored-name\0';
 for(const [version,K]of versions()){
  let responses=[],calls=[];const conn={async execGit(r,args,signal,options){calls.push({root:r,args:plain(args),options:plain(options)});assert(responses.length,'Unexpected dispatch');const v=responses.shift();if(v instanceof Error)throw v;return v;}},api=new K(conn),repo='/trusted/root';
  const cache=new Map([[oid,'cached']]);assert.equal(await api.blob(repo,'',cache),null);assert.equal(calls.length,0);rows.push({version,label:'null entry',calls:0,cache:[...cache]});
  for(const mode of ['120000','160000','040000','100600']){await assert.rejects(api.blob(repo,entry(mode),cache),e=>e.message==='符号链接和子模块请使用整文件操作。');assert.equal(calls.length,0);rows.push({version,label:'unsupported mode before cache',mode,calls:0});}
  for(const text of ['', '\ufeffcache\r\n'])for(const mode of ['100644','100755']){cache.set(oid,text);const v=await api.blob(repo,entry(mode),cache);assert.deepEqual(plain(v),{text,mode});assert.equal(calls.length,0);rows.push({version,label:'OID cache hit',mode,text,calls:0});}
  const good=[['empty',Buffer.alloc(0)],['BOM mixed newline',Buffer.from('\ufeff中文😀\r\nline\nend')],['exact two MiB',Buffer.alloc(limit,65)]];
  for(const [label,bytes]of good){calls=[];responses=[result(String(bytes.length)+'\n'),{...result(''),stdoutBytes:bytes}];const c=new Map(),saved=Buffer.from(bytes),v=await api.blob(repo,entry(),c);assert.deepEqual(plain(v),{text:bytes.toString('utf8'),mode:'100644'});assert.deepEqual(bytes,saved);assert.equal(responses.length,0);assert.equal(c.get(oid),v.text);assert.deepEqual(calls.map(c=>c.args),[['cat-file','-s',oid],['cat-file','blob',oid]]);assert.deepEqual(calls[0].options,{maxOutputBytes:8*limit,strictUtf8:true});assert.deepEqual(calls[1].options,{binary:true,maxOutputBytes:limit});const count=calls.length;assert.equal((await api.blob(repo,entry('100755'),c)).mode,'100755');assert.equal(calls.length,count);rows.push({version,label,bytes:bytes.length,inputSha256:hash(bytes),output:compact(v.text),calls,cacheTextSha256:hash(c.get(oid)),secondMode:'100755',secondDispatches:0});}
  const cases=[
   ['oversize precheck',[result(String(limit+1))],'文件超过 2 MiB，请使用整文件操作。',undefined,1],
   ['binary',[result('3'),{...result(''),stdoutBytes:Buffer.from([0,65,10])}],'二进制文件不支持按块或按行操作。',undefined,2],
   ['invalid UTF8',[result('2'),{...result(''),stdoutBytes:Buffer.from([255,128])}],'仅 UTF-8 文本支持按块或按行操作。',undefined,2],
   ['growth after size',[result('1'),{...result(''),stdoutBytes:Buffer.alloc(limit+1,65)}],'文件超过 2 MiB，请使用整文件操作。',undefined,2],
   ['blob missing',[result('1'),result('',1,'gone')],'文件、暂存区或 HEAD 已变化，请刷新差异后重新选择。',409,2],
   ['binary bytes missing',[result('1'),result('text only')],'文件、暂存区或 HEAD 已变化，请刷新差异后重新选择。',409,2],
   ['size command failure',[result('',128,'  missing object\n')],'missing object',400,1],
  ];
  for(const [label,queue,message,statusCode,count]of cases){calls=[];responses=queue;const c=new Map([['other','kept']]),saved=[...c];await assert.rejects(api.blob(repo,entry(),c),e=>e.message===message&&e.statusCode===statusCode);assert.equal(calls.length,count);assert.deepEqual([...c],saved);assert.equal(responses.length,0);rows.push({version,label,message,statusCode,calls,cacheUnchanged:true});}
  const error=new CommandOutputLimitError();calls=[];responses=[result('1'),error];const c=new Map();await assert.rejects(api.blob(repo,entry(),c),e=>e===error);assert.equal(c.size,0);rows.push({version,label:'output limit rejection',cacheUnchanged:true,message:error.message,calls});
  // A failed read must not poison the caller's per-read cache; a later successful read re-fetches.
  calls=[];responses=[result('1'),{...result(''),stdoutBytes:Buffer.from('x')}];assert.equal((await api.blob(repo,entry(),c)).text,'x');assert.equal(calls.length,2);rows.push({version,label:'fresh read after failure',text:'x',calls});
  const controller=new AbortController(),reason=new Error('cancelled'),aborted=new K({signal:controller.signal,execGit(){throw Error('Must not dispatch');}});controller.abort(reason);await assert.rejects(aborted.blob(repo,entry(),new Map()),e=>e===reason);assert.equal((await aborted.blob(repo,entry(),new Map([[oid,'cached']]))).text,'cached');rows.push({version,label:'uncached preabort cached pure return',uncachedDispatches:0,cachedText:'cached',boundary:'Cache hit does not poll cancellation. Owning consumer checks before entering; internal blob entry is trusted.'});
 }
 proof('blob-read-matrix',{rows,oid,limit,boundary:'Trusted typed internal entries only. Exact guard/command ordering, immutable OID cache empty string hits, current mode on same OID, no caching of rejected reads. Transport growth case simulates a size/data mismatch; real adapters separately enforce output cap.'});
});
function snapshot(directory){const files={},modes={},links={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=path.relative(directory,f);modes[r]=fs.lstatSync(f).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(f);else if(e.isDirectory())walk(f);else if(e.isFile())files[r]=hash(fs.readFileSync(f));}}walk(directory);return {files,modes,links};}
async function real(t,ssh){
 const f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);let connection;
 if(ssh){const server=await startSSHServer();t.after(()=>server.close());connection=new SSHConnection(server.options);connection.on('error',()=>{});await connection.connect();t.after(()=>connection.disconnect());}else{connection=new NativeRepositoryConnection();t.after(()=>connection.close());}
 const file="目录/中文 '\"$()\\\n.txt",bytes=Buffer.from('\ufeff中文😀\r\nsecond\nend');f.write(file,bytes);f.git('add','--',file);f.git('commit','-qm','blob fixture');
 const objects=[['unicode BOM',bytes],['empty',Buffer.alloc(0)],['exact two MiB',Buffer.alloc(limit,65)],['oversize',Buffer.alloc(limit+1,65)],['binary',Buffer.from([0,65,10])],['invalid UTF8',Buffer.from([255,128])]].map(([label,b])=>({label,bytes:b,oid:execFileSync('git',['-C',f.repo,'hash-object','-w','--stdin'],{input:b,encoding:'utf8'}).trim()}));
 const before=snapshot(f.root),otherBefore=snapshot(other.root),rows=[];
 for(const [version,K]of versions()){
  const calls=[],transport={execGit:async(r,a,s,o)=>{calls.push({root:r,args:plain(a),options:plain(o)});return connection.execGit(r,a,s,o);}},api=new K(transport);
  for(const object of objects){const {label,oid,bytes}=object,entry='100644 blob '+oid+'\t'+file+'\0',cache=new Map(),start=calls.length;let output,error;
   if(['oversize','binary','invalid UTF8'].includes(label)){const want=label==='oversize'?'文件超过 2 MiB，请使用整文件操作。':label==='binary'?'二进制文件不支持按块或按行操作。':'仅 UTF-8 文本支持按块或按行操作。';await assert.rejects(api.blob(f.repo,entry,cache),e=>(error=e.message)===want);assert.equal(cache.size,0);assert.equal(calls.length-start,label==='oversize'?1:2);}
   else{const got=await api.blob(f.repo,entry,cache);assert.equal(got.text,bytes.toString('utf8'));assert.equal(got.mode,'100644');output=compact(got.text);assert.equal(calls.length-start,2);const n=calls.length;assert.equal((await api.blob(f.repo,'100755 blob '+oid+'\tother-name\0',cache)).mode,'100755');assert.equal(calls.length,n);}
   rows.push({version,label,oid,input:compact(bytes.toString('utf8')),rawBytes:bytes.length,rawSha256:hash(bytes),output,error,commands:calls.slice(start),cacheSize:cache.size});
  }
  const tracked=objects[0],unknown=await assert.rejects(api.blob(other.repo,'100644 blob '+tracked.oid+'\tname\0',new Map()),e=>e.statusCode===400);rows.push({version,label:'object absent in second root',root:other.repo,oid:tracked.oid,statusCode:400});
  const text=await api.git(f.repo,['show',':'+file]);assert.equal(text,bytes.toString('utf8'));rows.push({version,label:'text wrapper exact real stdout',actual:compact(text),expected:compact(bytes.toString('utf8'))});
 }
 assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);
 proof(ssh?'blob-real-ssh':'blob-real-native',{rows,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),boundary:'Original extracted helpers and current production helpers share actual native or encrypted loopback SSH transport. All objects created before read snapshot; reads preserve complete fixture files/modes/link targets. OID cache is explicitly per read; no cache borrowed across repository roots.'});
}
test('P0 partial blob native real Git preserves bytes modes OID cache and repository isolation',async t=>real(t,false));
test('P0 partial blob SSH real Git preserves bytes modes OID cache and repository isolation',async t=>real(t,true));
test('P0 partial blob SDK owns editable resources rejects foreign unsafe calls and exposes no helper RPC',async t=>{
 const {spawnAgent}=require('@alune/agent-client/node'),os=require('node:os'),f=createRepository(),other=createRepository(),state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b46-sdk-'));t.after(f.close);t.after(other.close);t.after(()=>fs.rmSync(state,{recursive:true,force:true}));f.write('tracked.txt','new\n');other.write('tracked.txt','other\n');
 const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),state],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
 try{const init=await child.client.initialize(),resource=(await child.client.registerRepository(f.repo)).resource,second=(await child.client.registerRepository(other.repo)).resource,read=(r=resource)=>child.client.readRepository(r,'editableDiff',{file:'tracked.txt',staged:false}),p=await read(),q=await read(second);assert.equal(resource.agentId,init.agentId);assert.match(p.diff,/new/);assert.doesNotMatch(p.diff,/other/);assert.match(q.diff,/other/);assert(p.revision);const rows=[],ownBefore=snapshot(f.root),otherBefore=snapshot(other.root);
  for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}]){await assert.rejects(read(foreign),e=>e.kind==='not-found');rows.push({label:'foreign resource',kind:'not-found'});}
  for(const params of [{file:'../escape',staged:false},{file:'.git/config',staged:false},{file:'tracked.txt',staged:false,path:other.repo}]){await assert.rejects(child.client.request('repositories.read',{resource,kind:'editableDiff',params}),e=>e.kind==='invalid-params');rows.push({label:'invalid params',params,kind:'invalid-params'});}
  for(const method of ['partialChanges.git','partialChanges.blob','blob','git.execute']){await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');rows.push({method,kind:'unknown-method'});}
  const a=new AbortController();a.abort();await assert.rejects(child.client.readRepository(resource,'editableDiff',{file:'tracked.txt',staged:false},{signal:a.signal}),e=>e.kind==='cancelled');assert.deepEqual(snapshot(f.root),ownBefore);assert.deepEqual(snapshot(other.root),otherBefore);
  const intent={resource,kind:'partialDiff',args:[{file:'tracked.txt',action:'stage',revision:p.revision,selection:{hunks:[0]}}]},request={...intent,revision:await child.client.prepareRepositoryWrite(intent),operationId:randomUUID()};await child.client.writeRepository(request);assert.equal(f.git('show',':tracked.txt'),'new\n');assert.equal(other.git('show',':tracked.txt'),'original\n');assert.deepEqual(snapshot(other.root),otherBefore);
  proof('blob-sdk',{resource,second,preview:p,otherPreview:q,rows,preabort:true,ownBefore,otherBefore,otherAfter:snapshot(other.root),indexAfter:f.git('show',':tracked.txt'),boundary:'Actual current stdio SDK owning editableDiff/partialDiff consumer. Independent task-journal companions cover durable unknown and no automatic replay. No helper RPC or frozen full consumer equivalence claimed.'});
 }finally{await child.close();}
});
