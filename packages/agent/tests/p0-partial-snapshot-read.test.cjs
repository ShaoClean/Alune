const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const ts=require('typescript');
const {execFileSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {createRepository}=require('./helpers/local-repository.cjs');
const {startSSHServer}=require('./helpers/ssh-server.cjs');
const {NativeRepositoryConnection}=require('../dist/adapters/git/native');
const {SSHConnection}=require('../dist/adapters/ssh/connection-manager');
const {PartialReads}=require('../dist/modules/git/partial-changes');
const {parsePatchHunks}=require('@alune/domain');
const root=path.resolve(__dirname,'../../..'),baseline='3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash=v=>createHash('sha256').update(v).digest('hex'),token=v=>hash(JSON.stringify(v));
const plain=v=>JSON.parse(JSON.stringify(v));
const result=(stdout='',exitCode=0,stderr='')=>({stdout,exitCode,stderr});
const stale='文件、暂存区或 HEAD 已变化，请刷新差异后重新选择。';
function proof(name,value){if(process.env.P0_PARTIAL_SNAPSHOT_READ_PROOF_DIR)fs.writeFileSync(path.join(process.env.P0_PARTIAL_SNAPSHOT_READ_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
let old;
function frozen(){
 if(old)return old;
 const base=process.env.P0_PARTIAL_SNAPSHOT_READ_FROZEN,inventory=[],dependencies=[],modules={'node:crypto':require('node:crypto'),'node:path':require('node:path'),'node:util':require('node:util'),util:require('node:util')};
 const source=f=>{const s=fs.readFileSync(path.join(base,f),'utf8');assert.equal(s,execFileSync('git',['show',baseline+':'+f],{cwd:root,encoding:'utf8'}));return s;};
 const execute=(s,f)=>{const m={exports:{}};vm.runInNewContext(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>{assert(Object.hasOwn(modules,n),'Unreviewed frozen dependency '+n);return modules[n];},Buffer,Error,TextDecoder,AbortSignal,Map},{filename:f});return m.exports;};
 const extract=(f,names)=>{const s=source(f),ast=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true);return names.map(name=>{const matches=ast.statements.filter(x=>x.name?.text===name||ts.isVariableStatement(x)&&x.declarationList.declarations.some(d=>d.name.getText(ast)===name));assert.equal(matches.length,1,name);const x=matches[0];inventory.push({file:f,name,line:ast.getLineAndCharacterOfPosition(x.getStart(ast)).line+1,sha256:hash(x.getText(ast))});return x.getText(ast);}).join('\n');};
 for(const n of ['git-shell','repository-transport','repository-path','sftp-file']){const f='packages/ssh-client/src/'+n+'.ts',s=source(f);modules['./'+n]=execute(s,f);dependencies.push({file:f,sha256:hash(s)});}
 const parser='packages/shared/src/partial-diff.ts',parserSource=source(parser);modules['@alune/shared']=execute(parserSource,parser);dependencies.push({file:parser,sha256:hash(parserSource)});
 const validator='packages/ssh-client/src/repository-files.ts';modules['./repository-files']=execute("import {isWindowsPath} from './git-shell';\n"+extract(validator,['RepositoryFileError','validateRepositoryPath']),validator);
 const file='packages/ssh-client/src/partial-changes.ts',s=source(file),ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true),klass=ast.statements.find(x=>ts.isClassDeclaration(x)&&x.name.text==='PartialChanges');
 const parts=extract(file,['MAX_BYTES','hash','missing','PartialChangesError','stale','Unsupported']),methods=[];
 for(const name of ['constructor','git','decode','blob','worktree','snapshot','read']){const matches=klass.members.filter(x=>name==='constructor'?ts.isConstructorDeclaration(x):x.name?.getText(ast)===name);assert.equal(matches.length,1,name);const x=matches[0];methods.push(x.getText(ast));inventory.push({file,name:'PartialChanges.'+name,line:ast.getLineAndCharacterOfPosition(x.getStart(ast)).line+1,sha256:hash(x.getText(ast))});}
 const imports="import {createHash} from 'node:crypto'; import {promisify} from 'node:util'; import {runGit} from './repository-transport'; import {validateRepositoryPath} from './repository-files'; import {joinRepositoryPath} from './repository-path'; import {readSftpChunks} from './sftp-file'; import {parsePatchHunks} from '@alune/shared';\n";
 old=execute(imports+parts+'\nexport class FrozenReads { '+methods.join('\n')+' }',file).FrozenReads;
 proof('snapshot-read-frozen-extraction',{baseline,inventory,dependencies,boundary:'Unchanged original AST constructor/git/decode/blob/worktree/snapshot/read and lexical declarations; original validator declarations; five complete frozen dependency modules. No preview/apply/full enclosing source or old SSH executor credit.'});return old;
}
const versions=()=>[['frozen',frozen()],['current',PartialReads]];
const file="目录/中文 '\"$()\\\n.txt",oid='a'.repeat(40),index='100644 '+oid+' 0\t'+file+'\0',tree='100755 blob '+oid+'\t'+file+'\0';
const attributes=(v=['unspecified','unset','unspecified'])=>['filter','working-tree-encoding','ident'].map((a,i)=>file+'\0'+a+'\0'+v[i]+'\0').join('');
const commands={prefix:['rev-parse','--show-prefix'],index:['ls-files','--stage','-z','--',file],head:['rev-parse','--verify','--quiet','HEAD'],tree:['ls-tree','-z','HEAD','--',file],attr:['check-attr','-z','filter','working-tree-encoding','ident','--',file]};
test('P0 partial snapshot frozen and current preserve exact state guard ordering cache and command boundaries',async()=>{
 const rows=[];
 for(const [version,K]of versions()){
  const run=async({label,queue,expectedCommands,error,statusCode,expected,helperError,helperAt})=>{
   const calls=[],helpers=[],cache=new Map([['kept','bytes']]),reason=new Error('helper failure'),connection={async execGit(r,a,s,o){calls.push({root:r,args:plain(a),options:o?plain(o):null});assert.equal(r,'/trusted');assert(queue.length,'unexpected dispatch');return queue.shift();}};
   const api=new K(connection);api.blob=async(r,e,c)=>{assert.equal(r,'/trusted');assert.equal(c,cache);helpers.push({kind:'blob',entry:e});if(helperError&&helpers.length===helperAt)throw reason;return e?{text:e===tree?'before':'cached',mode:e.split(' ')[0]}:null;};api.worktree=async(r,f)=>{assert.equal(r,'/trusted');assert.equal(f,file);helpers.push({kind:'worktree',file:f});if(helperError&&helpers.length===helperAt)throw reason;return {text:'working\r\n',mode:'100755'};};
   let actual;if(error)await assert.rejects(api.snapshot('/trusted',file,cache),e=>e.message===error&&e.statusCode===statusCode);else if(helperError)await assert.rejects(api.snapshot('/trusted',file,cache),e=>e===reason);else{actual=await api.snapshot('/trusted',file,cache);assert.deepEqual(plain(actual),expected);}
   assert.deepEqual(calls.map(c=>c.args),expectedCommands);assert.equal(queue.length,0);assert.deepEqual([...cache],[['kept','bytes']]);
   if(error)assert.equal(helpers.length,0);else if(!helperError){assert.deepEqual(helpers,[{kind:'blob',entry:expected.tree},{kind:'blob',entry:expected.index?expected.index.split('\0')[0].replace(/^(\d+) ([a-f0-9]+) 0\t/,'$1 blob $2\t'):''},{kind:'worktree',file}]);}
   rows.push({version,label,calls,helpers,actual:plain(actual??null),error,statusCode,helperFailureIdentity:!!helperError,cacheUnchanged:true});
  };
  const success=(head,i,tr,a)=>({head,index:i,tree:tr,attributes:a,before:tr?{text:'before',mode:'100755'}:null,cached:i?{text:'cached',mode:'100644'}:null,working:{text:'working\r\n',mode:'100755'}});
  const steps=[commands.prefix,commands.index,commands.head,commands.tree,commands.attr],good=()=>[result(''),result(index),result('head\n'),result(tree),result(attributes())];
  await run({label:'tracked exact raw state',queue:good(),expectedCommands:steps,expected:success('head\n',index,tree,attributes())});
  await run({label:'unborn staged file',queue:[result(''),result(index),result('',1),result(attributes())],expectedCommands:steps.filter(c=>c!==commands.tree),expected:success('',index,'',attributes())});
  await run({label:'HEAD only deletion',queue:[result(''),result(''),result('head\n'),result(tree),result(attributes())],expectedCommands:steps,expected:success('head\n','',tree,attributes())});
  const rejectCases=[
   ['subdirectory root',[result('sub/\n')],steps.slice(0,1),'请从仓库根目录操作。'],
   ['index another file',[result(''),result(index.replace(file,'other'))],steps.slice(0,2),'请选择单个文件。'],
   ['index multiple files',[result(''),result(index+index.replace(file,'other'))],steps.slice(0,2),'请选择单个文件。'],
   ['unmerged stage',[result(''),result(index.replace(' 0\t',' 2\t'))],steps.slice(0,2),'请先解决此文件的合并冲突。'],
   ['malformed index',[result(''),result('bad\t'+file+'\0')],steps.slice(0,2),'请先解决此文件的合并冲突。'],
   ['HEAD error',[result(''),result(index),result('',128)],steps.slice(0,3),stale,409],
   ['HEAD signal exit',[result(''),result(index),result('',null)],steps.slice(0,3),stale,409],
   ['tree another path',[result(''),result(index),result('head\n'),result(tree.replace(file,'other'))],steps.slice(0,4),'请选择单个文件。'],
   ['tree multiple paths',[result(''),result(index),result('head\n'),result(tree+tree)],steps.slice(0,4),'请选择单个文件。'],
   ['untracked',[result(''),result(''),result('head\n'),result('')],steps.slice(0,4),'未跟踪新文件请先使用整文件暂存。'],
   ...['filter','working-tree-encoding','ident'].map((a,i)=>{const v=['unspecified','unset','unspecified'];v[i]=i===0?'lfs':i===1?'UTF-16':'set';return ['attribute '+a,[result(''),result(index),result('head\n'),result(tree),result(attributes(v))],steps,'此文件使用内容过滤器或编码转换，请使用整文件操作。'];}),
   ['Git state error',[result('',128,' failure\n')],steps.slice(0,1),'failure',400],
  ];
  for(const [label,queue,expectedCommands,error,statusCode]of rejectCases)await run({label,queue,expectedCommands,error,statusCode});
  for(const helperAt of [1,2,3])await run({label:'helper failure '+helperAt,queue:good(),expectedCommands:steps,helperError:true,helperAt});
  for(const bad of ['', '../escape','.git/config','/absolute','a//b','a/../b','a\0b']){let calls=0;await assert.rejects(new K({execGit(){calls++;throw Error('dispatch forbidden');}}).snapshot('/trusted',bad),e=>e.statusCode===400);assert.equal(calls,0);rows.push({version,label:'invalid path',file:bad,dispatches:0,statusCode:400});}
  const c=new AbortController(),reason=new Error('preabort');c.abort(reason);let calls=0;await assert.rejects(new K({signal:c.signal,execGit(){calls++;}}).snapshot('/trusted',file),e=>e===reason);assert.equal(calls,0);rows.push({version,label:'preabort',dispatches:0});
 }
 proof('snapshot-matrix',{rows,boundary:'Snapshot and its real original/current git wrapper run; blob/worktree are explicitly replaced only in this controlled matrix to inspect conversion, cache identity and early-guard dispatch. Full real helpers run in native/SSH matrices.'});
});
const patch='diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new\n';
const sample=()=>({head:'head\n',index:'index\0',tree:'tree\0',attributes:'attrs\0',before:{text:'old\n',mode:'100644'},cached:{text:'old\n',mode:'100644'},working:{text:'new\n',mode:'100755'}});
test('P0 partial read frozen and current double check every state field exact diff flags limits and revision identities',async()=>{
 const rows=[];
 for(const [version,K]of versions()){
  const run=async({label,staged=false,fullFile=false,diff=patch,after=sample(),error,statusCode,failureAt,canonical='/canonical/root'})=>{
   const calls=[],maps=[],reason=new Error('injected read failure'),state=sample(),api=new K({withSftp:fn=>fn({realpath:(p,cb)=>{calls.push({canonical:p});if(failureAt==='canonical')cb(reason);else cb(null,canonical);}})});
   api.snapshot=async(r,f,cache)=>{assert.equal(r,'/alias/root');assert.equal(f,file);maps.push(cache);if(failureAt==='snapshot'+maps.length)throw reason;return maps.length===1?state:after;};api.git=async(r,a)=>{calls.push({root:r,args:plain(a)});if(failureAt==='diff')throw reason;return diff;};
   let actual;if(error)await assert.rejects(api.read('/alias/root',file,staged,fullFile),e=>e.message===error&&e.statusCode===statusCode);else if(failureAt)await assert.rejects(api.read('/alias/root',file,staged,fullFile),e=>e===reason);else{
    actual=await api.read('/alias/root',file,staged,fullFile);assert.deepEqual(plain(actual.state),state);assert.equal(actual.diff,diff);assert.deepEqual(plain(actual.hunks),plain(parsePatchHunks(diff)));assert.equal(actual.revision,token([version==='frozen'?'/alias/root':canonical,file,staged,state,diff]));
   }
   if(maps.length===2)assert.equal(maps[0],maps[1]);assert(maps[0] instanceof Map);assert.equal(maps[0].size,0);
   if(failureAt!=='snapshot1')assert.deepEqual(calls[0].args,['-c','core.quotepath=false','diff','--no-color','--no-ext-diff','--no-textconv','--no-renames','--full-index','--src-prefix=a/','--dst-prefix=b/',fullFile?'--unified=2147483647':'--unified=3','--inter-hunk-context=0','--diff-algorithm=myers','--no-indent-heuristic',...(staged?['--cached']:[]),'--',file]);
   rows.push({version,label,staged,fullFile,diffLines:diff.split('\n').length,diffSha256:hash(diff),snapshots:maps.length,sameReadCache:maps.length===2?maps[0]===maps[1]:null,calls,error,statusCode,failureAt,actual:actual?{state:actual.state,revision:actual.revision,hunks:plain(actual.hunks)}:undefined});return maps[0];
  };
  let last;for(const staged of [false,true])for(const fullFile of [false,true]){const map=await run({label:'exact diff and token',staged,fullFile});assert.notEqual(map,last);last=map;}
  for(const key of Object.keys(sample())){const after=sample();after[key]=typeof after[key]==='string'?after[key]+'changed':{...after[key],text:'external edit'};await run({label:'state drift '+key,after,error:stale,statusCode:409});}
  for(const key of ['before','cached','working']){const after=sample();after[key].mode='100600';await run({label:'mode drift '+key,after,error:stale,statusCode:409});}
  await run({label:'no hunks',diff:'',error:'没有可按块或按行操作的文本改动。'});
  await run({label:'exact 10000 lines',diff:patch+'\n'.repeat(10000-patch.split('\n').length)});
  await run({label:'over 10000 lines',diff:patch+'\n'.repeat(10001-patch.split('\n').length),error:'差异超过 10,000 行，请使用整文件操作。'});
  for(const failureAt of ['snapshot1','diff','snapshot2',...(version==='current'?['canonical']:[])])await run({label:'error identity '+failureAt,failureAt});
 }
 proof('read-matrix',{rows,boundary:'Read executes unchanged frozen/current method with controlled snapshot/git dependencies. Shared cache only within one read, separate map for each read; exact token formula checked independently. Current canonical root identity intentionally replaces frozen caller spelling.'});
});
function diskSnapshot(directory){const files={},modes={},links={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=path.relative(directory,f);modes[r]=fs.lstatSync(f).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(f);else if(e.isDirectory())walk(f);else if(e.isFile())files[r]=hash(fs.readFileSync(f));}}walk(directory);return {files,modes,links};}
async function real(t,ssh){
 const f=createRepository(),other=createRepository(),unborn=createRepository({initial:false});t.after(f.close);t.after(other.close);t.after(unborn.close);let connection;
 if(ssh){const server=await startSSHServer();t.after(()=>server.close());connection=new SSHConnection(server.options);connection.on('error',()=>{});await connection.connect();t.after(()=>connection.disconnect());}else{connection=new NativeRepositoryConnection();t.after(()=>connection.close());}
 const beforeText='\ufeff中文\r\nold',indexText='\ufeff中文\r\nstaged',workingText='\ufeff中文\r\nworking';f.write(file,beforeText);f.git('add','--',file);f.git('commit','-qm','snapshot fixture');f.write(file,indexText);f.git('add','--',file);f.write(file,workingText);fs.chmodSync(path.join(f.repo,file),0o755);other.write('tracked.txt','other\n');unborn.write('new.txt','new\n');unborn.git('add','--','new.txt');
 const alias=path.join(f.root,'alias');fs.symlinkSync(f.repo,alias,'dir');const rows=[];
 for(const [version,K]of versions()){
  const api=new K(connection),initial=diskSnapshot(f.root),otherInitial=diskSnapshot(other.root),unbornInitial=diskSnapshot(unborn.root);
  const s=await api.snapshot(f.repo,file);assert.equal(s.before.text,beforeText);assert.equal(s.cached.text,indexText);assert.equal(s.working.text,workingText);assert.equal(s.working.mode,'100755');assert.equal(s.index,f.git('ls-files','--stage','-z','--',file));assert.equal(s.tree,f.git('ls-tree','-z','HEAD','--',file));assert.equal(s.head,f.git('rev-parse','HEAD'));
  rows.push({version,label:'snapshot exact HEAD index worktree',state:plain(s)});
  for(const staged of [false,true])for(const fullFile of [false,true]){const r=await api.read(f.repo,file,staged,fullFile);assert.deepEqual(plain(r.state),plain(s));assert(r.hunks.length);assert.match(r.diff,staged?/staged/:/working/);assert.equal(r.revision,token([version==='frozen'?f.repo:fs.realpathSync(f.repo),file,staged,s,r.diff]));rows.push({version,label:'real diff',staged,fullFile,revision:r.revision,diff:r.diff,hunks:plain(r.hunks),state:plain(r.state),identity:version==='frozen'?f.repo:fs.realpathSync(f.repo),file});}
  const viaAlias=await api.read(alias,file,false),direct=await api.read(f.repo,file,false);assert.deepEqual(plain(viaAlias.state),plain(direct.state));if(version==='current')assert.equal(viaAlias.revision,direct.revision);else{assert.notEqual(viaAlias.revision,direct.revision);assert.equal(viaAlias.revision,token([alias,file,false,viaAlias.state,viaAlias.diff]));}rows.push({version,label:'root alias identity',alias,direct:direct.revision,aliased:viaAlias.revision,equal:version==='current',boundary:'Accepted intentional current canonical-root identity; frozen token was caller-spelling dependent.'});
  const u=await api.snapshot(unborn.repo,'new.txt');assert.equal(u.head,'');assert.equal(u.before,null);assert.equal(u.cached.text,'new\n');assert.equal(u.working.text,'new\n');assert((await api.read(unborn.repo,'new.txt',true)).hunks.length);rows.push({version,label:'unborn repository',state:plain(u)});
  const o=await api.read(other.repo,'tracked.txt',false);assert.equal(o.state.working.text,'other\n');assert.doesNotMatch(o.diff,/working|staged/);assert.notEqual(o.revision,direct.revision);rows.push({version,label:'second repository isolated',state:plain(o.state),revision:o.revision});
  assert.deepEqual(diskSnapshot(f.root),initial);assert.deepEqual(diskSnapshot(other.root),otherInitial);assert.deepEqual(diskSnapshot(unborn.root),unbornInitial);rows.push({version,label:'all read bytes modes links unchanged',before:initial,after:diskSnapshot(f.root),otherBefore:otherInitial,otherAfter:diskSnapshot(other.root),unbornBefore:unbornInitial,unbornAfter:diskSnapshot(unborn.root)});
  // Mutate only the isolated fixture between snapshots, as an external editor would.
  let changed=false;const conn={withSftp:op=>connection.withSftp(op),execGit:async(r,a,signal,options)=>{const answer=await connection.execGit(r,a,signal,options);if(!changed&&a.includes('--diff-algorithm=myers')){changed=true;f.write(file,workingText+'external');}return answer;}};
  await assert.rejects(new K(conn).read(f.repo,file,false),e=>e.statusCode===409&&e.message===stale);assert(changed);assert.equal(fs.readFileSync(path.join(f.repo,file),'utf8'),workingText+'external');rows.push({version,label:'real edit between reads rejected',statusCode:409,externalBytes:workingText+'external'});f.write(file,workingText);fs.chmodSync(path.join(f.repo,file),0o755);
  f.write('.gitattributes','* ident\n');const attrBefore=diskSnapshot(f.root);await assert.rejects(api.snapshot(f.repo,file),e=>/内容过滤器/.test(e.message));assert.deepEqual(diskSnapshot(f.root),attrBefore);rows.push({version,label:'real ident attribute refused',snapshotUnchanged:true});fs.unlinkSync(path.join(f.repo,'.gitattributes'));
  const cancel=new AbortController(),reason=new Error('preabort');cancel.abort(reason);let calls=0;const aborted=new K({signal:cancel.signal,execGit(){calls++;},withSftp:op=>connection.withSftp(op)});await assert.rejects(aborted.read(f.repo,file,false),e=>e===reason);assert.equal(calls,0);rows.push({version,label:'real consumer preabort',dispatches:0});
 }
 proof(ssh?'snapshot-read-real-ssh':'snapshot-read-real-native',{rows,boundary:'Full extracted frozen snapshot/read and current production PartialReads with actual native or encrypted loopback SSH transport and real SFTP. Special path, BOM/mixed endings/no final newline, staged/unstaged/full diff, unborn repository, alias identity, separate roots, external edit and attribute guards. Only explicit test setup/editor injections mutate isolated fixtures; successful and refused pure reads snapshot unchanged.'});
}
test('P0 partial snapshot read native real Git retains exact state detects edits and canonicalizes revision identity',async t=>real(t,false));
test('P0 partial snapshot read SSH real Git retains exact state detects edits and canonicalizes revision identity',async t=>real(t,true));
test('P0 partial snapshot read SDK owns repository results rejects unsafe foreign calls and stale partial writes',async t=>{
 const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository(),other=createRepository(),state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b47-sdk-'));t.after(f.close);t.after(other.close);t.after(()=>fs.rmSync(state,{recursive:true,force:true}));f.write('tracked.txt','new\n');other.write('tracked.txt','other\n');
 const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),state],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
 try{const init=await child.client.initialize(),resource=(await child.client.registerRepository(f.repo)).resource,second=(await child.client.registerRepository(other.repo)).resource,read=(r=resource)=>child.client.readRepository(r,'editableDiff',{file:'tracked.txt',staged:false}),p=await read(),q=await read(second);assert.equal(resource.agentId,init.agentId);assert.match(p.diff,/new/);assert.doesNotMatch(p.diff,/other/);assert.match(q.diff,/other/);assert(p.revision);const rows=[],ownBefore=diskSnapshot(f.root),otherBefore=diskSnapshot(other.root);
  for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}]){await assert.rejects(read(foreign),e=>e.kind==='not-found');rows.push({label:'foreign resource',kind:'not-found'});}
  for(const params of [{file:'../escape',staged:false},{file:'.git/config',staged:false},{file:'tracked.txt',staged:false,path:other.repo}]){await assert.rejects(child.client.request('repositories.read',{resource,kind:'editableDiff',params}),e=>e.kind==='invalid-params');rows.push({label:'invalid params',params,kind:'invalid-params'});}
  for(const method of ['partialChanges.snapshot','partialChanges.read','snapshot','git.execute']){await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');rows.push({method,kind:'unknown-method'});}
  const a=new AbortController();a.abort();await assert.rejects(child.client.readRepository(resource,'editableDiff',{file:'tracked.txt',staged:false},{signal:a.signal}),e=>e.kind==='cancelled');assert.deepEqual(diskSnapshot(f.root),ownBefore);assert.deepEqual(diskSnapshot(other.root),otherBefore);
  const intent={resource,kind:'partialDiff',args:[{file:'tracked.txt',action:'stage',revision:p.revision,selection:{hunks:[0]}}]},revision=await child.client.prepareRepositoryWrite(intent);f.write('tracked.txt','external\n');const changed=diskSnapshot(f.root);await assert.rejects(child.client.writeRepository({...intent,revision,operationId:randomUUID()}),e=>e.kind==='conflict');assert.deepEqual(diskSnapshot(f.root),changed);rows.push({label:'stale write conflict',kind:'conflict',snapshotUnchanged:true});
  const fresh=await read(),next={...intent,args:[{...intent.args[0],revision:fresh.revision}]};await child.client.writeRepository({...next,revision:await child.client.prepareRepositoryWrite(next),operationId:randomUUID()});assert.equal(f.git('show',':tracked.txt'),'external\n');assert.equal(other.git('show',':tracked.txt'),'original\n');assert.deepEqual(diskSnapshot(other.root),otherBefore);
  proof('snapshot-read-sdk',{resource,second,preview:p,otherPreview:q,rows,preabort:true,ownBefore,otherBefore,otherAfter:diskSnapshot(other.root),indexAfter:f.git('show',':tracked.txt'),boundary:'Current actual stdio SDK editableDiff and partialDiff; stale rejected write plus fresh explicit operation in isolated fixture. Durable unknown/no automatic replay in separate companions, no helper RPC, no frozen full SDK equivalence claim.'});
 }finally{await child.close();}
});
