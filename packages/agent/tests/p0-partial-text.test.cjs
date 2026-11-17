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
const {PartialChanges,selectedContent}=require('../dist/modules/git/partial-changes-writes');
const {parsePatchHunks}=require('@alune/domain');
const root=path.resolve(__dirname,'../../..'),baseline='3c05f640fcc1a04c864e47bfc2880483ad48c984',limit=2*1024*1024;
const hash=v=>createHash('sha256').update(v).digest('hex');
const plain=v=>JSON.parse(JSON.stringify(v));
function proof(name,value){if(process.env.P0_PARTIAL_TEXT_PROOF_DIR)fs.writeFileSync(path.join(process.env.P0_PARTIAL_TEXT_PROOF_DIR,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
let old;
function frozen(){
 if(old)return old;
 const file='packages/ssh-client/src/partial-changes.ts',source=fs.readFileSync(path.join(process.env.P0_PARTIAL_TEXT_FROZEN,file),'utf8');
 assert.equal(source,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),parts=[],inventory=[];
 for(const name of ['MAX_BYTES','split','PartialChangesError','stale','Unsupported','selectedContent']){
  const matches=ast.statements.filter(s=>s.name?.text===name||ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)===name));assert.equal(matches.length,1,name);const s=matches[0];parts.push(s.getText(ast));inventory.push({name,line:ast.getLineAndCharacterOfPosition(s.getStart(ast)).line+1,sha256:hash(s.getText(ast))});
 }
 const klass=ast.statements.find(s=>ts.isClassDeclaration(s)&&s.name.text==='PartialChanges'),method=klass.members.filter(s=>s.name?.getText(ast)==='decode');assert.equal(method.length,1);
 parts.push('export class FrozenDecode { '+method[0].getText(ast)+' }');inventory.push({name:'PartialChanges.decode',line:ast.getLineAndCharacterOfPosition(method[0].getStart(ast)).line+1,sha256:hash(method[0].getText(ast))});
 const execute=(src,filename)=>{const m={exports:{}};vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Buffer,Error,TextDecoder},{filename});return m.exports;};
 const module=execute(parts.join('\n'),file),parserFile='packages/shared/src/partial-diff.ts',parserSource=fs.readFileSync(path.join(process.env.P0_PARTIAL_TEXT_FROZEN,parserFile),'utf8');assert.equal(parserSource,execFileSync('git',['show',baseline+':'+parserFile],{cwd:root,encoding:'utf8'}));
 old={select:module.selectedContent,decode:b=>new module.FrozenDecode().decode(b),parse:execute(parserSource,parserFile).parsePatchHunks};
 proof('partial-frozen-extraction',{baseline,file,inventory,parserFile,parserSha256:hash(parserSource),boundary:'Exact original AST declarations and complete decode method execute unchanged with their original lexical dependencies. No frozen constructor, SSH executor, read/apply method or enclosing module acceptance claimed; complete original parser value module executes.'});return old;
}
const versions=()=>[['frozen',frozen().select,frozen().decode,frozen().parse],['current',selectedContent,b=>new PartialReads({}).decode(b),parsePatchHunks]];
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function compact(text){return {bytes:Buffer.byteLength(text),sha256:hash(text),...(text.length<256?{text}:{})};}
function diffOf(t,before,after){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b45-diff-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'before'),before);fs.writeFileSync(path.join(dir,'after'),after);try{return execFileSync('git',['diff','--no-index','--no-ext-diff','--no-textconv','--no-color','--unified=2','--',path.join(dir,'before'),path.join(dir,'after')],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});}catch(e){assert.equal(e.status,1);return e.stdout.toString();}}
test('P0 partial selectedContent frozen and current preserve exact bytes for every selected replacement subset',t=>{
 const rows=[];
 for(const ending of ['\n','\r\n',''])for(const bom of ['','\ufeff']){
  const prefix=bom+'top\r\n',before=prefix+'old'+ending,after=prefix+'new'+ending,diff=diffOf(t,before,after);
  for(const [version,select,,parse]of versions()){
   const hunks=freeze(plain(parse(diff))),changes=hunks.flatMap(h=>h.rows.filter(r=>r.kind!=='context')),remove=changes.find(r=>r.kind==='remove').index,add=changes.find(r=>r.kind==='add').index;
   for(const reverse of [false,true])for(const chosen of [[],[remove],[add],[remove,add]]){
    const ids=new Set(chosen),saved=plain(hunks),base=reverse?after:before;
    const retained=reverse?!ids.has(add):!ids.has(remove),inserted=reverse?ids.has(remove):ids.has(add),oldText=reverse?'new':'old',newText=reverse?'old':'new';
    const pieces=[];if(reverse&&inserted)pieces.push(newText+ending);if(retained)pieces.push(oldText+ending);if(!reverse&&inserted)pieces.push(newText+ending);
    const expected=prefix+pieces.map((s,i)=>i<pieces.length-1&&!s.endsWith('\n')?s+'\n':s).join('');
    const actual=select(base,hunks,ids,reverse);assert.equal(actual,expected);assert.deepEqual(plain(hunks),saved);assert.deepEqual([...ids],chosen);
    rows.push({version,ending,bom,reverse,chosen,base:compact(base),expected:compact(expected),actual:compact(actual),inputsUnchanged:true});
   }
  }
 }proof('partial-selection-matrix',{rows,boundary:'Real Git no-index patches, two original/current parsers; independent expected bytes for all 2-row subsets, both directions, BOM and mixed/final endings.'});
});
test('P0 partial selectedContent frozen and current preserve sparse hunks CRLF normalization and reject stale input',t=>{
 const rows=[],before=Array.from({length:30},(_,i)=>'line '+i+'\n').join(''),after=before.replace('line 2\n','first\n').replace('line 25\n','last\n'),diff=diffOf(t,before,after);
 for(const [version,select,,parse]of versions()){
  const hunks=freeze(plain(parse(diff)));assert.equal(hunks.length,2);
  for(const reverse of [false,true])for(const indices of [[],[0],[1],[0,1]]){
   const ids=new Set(hunks.filter(h=>indices.includes(h.index)).flatMap(h=>h.rows.filter(r=>r.kind!=='context').map(r=>r.index)));
   let expected=reverse?after:before;for(const i of indices)expected=reverse?expected.replace(i===0?'first\n':'last\n',i===0?'line 2\n':'line 25\n'):expected.replace(i===0?'line 2\n':'line 25\n',i===0?'first\n':'last\n');
   const actual=select(reverse?after:before,hunks,ids,reverse);assert.equal(actual,expected);rows.push({version,label:'sparse',reverse,indices,expected:compact(expected),actual:compact(actual)});
  }
  const normalized=freeze(plain(parse('@@ -1,2 +1,2 @@\n one\n-old\n+new\n'))),ids=new Set(normalized[0].rows.filter(r=>r.kind!=='context').map(r=>r.index));
  assert.equal(select('one\r\nnew\r\n',normalized,ids,true),'one\r\nold\r\n');rows.push({version,label:'normalized CRLF discard',actual:'one\r\nold\r\n',expected:'one\r\nold\r\n'});
  const insertion=freeze([{index:0,oldStart:0,oldCount:0,newStart:1,newCount:1,rows:[{index:1,kind:'add',content:'new\n'}]}]),deletion=freeze([{index:0,oldStart:1,oldCount:1,newStart:0,newCount:0,rows:[{index:1,kind:'remove',content:'old\n'}]}]);
  for(const [label,base,patch,reverse,expected]of [['new empty','',insertion,false,'new\n'],['undo new','new\n',insertion,true,''],['delete final','old\n',deletion,false,''],['restore final','',deletion,true,'old\n']]){const actual=select(base,patch,new Set([1]),reverse);assert.equal(actual,expected);rows.push({version,label,actual,expected});}
  const h=plain(normalized),far=plain(normalized),negative=plain(normalized),overlap=[...plain(normalized),...plain(normalized)];far[0].oldStart=99;negative[0].oldStart=0;
  for(const [label,base,patch,reverse]of [['context mismatch','bad\nold\n',h,false],['removed mismatch','one\nother\n',h,false],['added mismatch','one\nother\n',h,true],['missing consumed row','one\n',h,false],['past end','one\nold\n',far,false],['negative position','one\nold\n',negative,false],['overlap','one\nold\n',overlap,false]]){const original=plain(patch);freeze(patch);assert.throws(()=>select(base,patch,new Set([2,3]),reverse),e=>e.statusCode===409&&/已变化/.test(e.message));assert.deepEqual(plain(patch),original);rows.push({version,label,statusCode:409,inputsUnchanged:true});}
 }proof('partial-stale-matrix',{rows,boundary:'Trusted parsed hunk contract only. Public selection/path validation belongs to current consumer/SDK tests; no new generic RPC.'});
});
test('P0 partial decode frozen and current enforce UTF8 BOM binary and exact two MiB boundaries without mutation',()=>{
 const rows=[],cases=[['empty',Buffer.alloc(0),''],['unicode',Buffer.from('中文😀\r\nend'),'中文😀\r\nend'],['BOM',Buffer.from('\ufeffhello\n'),'\ufeffhello\n'],['embedded BOM',Buffer.from('a\ufeffb'),'a\ufeffb'],['exact ascii',Buffer.alloc(limit,65),null],['exact unicode',Buffer.from('é'.repeat(limit/2)),null],['oversize',Buffer.alloc(limit+1,65),'文件超过 2 MiB，请使用整文件操作。'],['oversize nul',Buffer.alloc(limit+1),'文件超过 2 MiB，请使用整文件操作。'],['nul',Buffer.from([65,0,66]),'二进制文件不支持按块或按行操作。'],['nul and invalid',Buffer.from([0,255]),'二进制文件不支持按块或按行操作。'],...[[0x80],[0xff],[0xc0,0x80],[0xe2,0x82],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xef,0xbb]].map((b,i)=>['invalid '+i,Buffer.from(b),'仅 UTF-8 文本支持按块或按行操作。'])];
 for(const [version,,decode]of versions())for(const [label,bytes,want]of cases){const saved=Buffer.from(bytes),error=label.startsWith('invalid')||['oversize','oversize nul','nul','nul and invalid'].includes(label);let actual;if(error){assert.throws(()=>decode(bytes),e=>e.message===want&&e instanceof Error);actual={error:want};}else{const expected=want??bytes.toString('utf8'),text=decode(bytes);assert.equal(text,expected);actual=compact(text);}assert.deepEqual(bytes,saved);rows.push({version,label,inputBytes:bytes.length,inputSha256:hash(bytes),actual,inputsUnchanged:true});}
 proof('partial-decode-matrix',{rows,limit,boundary:'Pure synchronous decoder does not accept resource IDs or cancellation. Original guard ordering retained; exact UTF8 and byte limit, no UTF16 conversion.'});
});
function snapshot(directory){const files={},modes={},links={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name),r=path.relative(directory,f);modes[r]=fs.lstatSync(f).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(f);else if(e.isDirectory())walk(f);else if(e.isFile())files[r]=hash(fs.readFileSync(f));}}walk(directory);return {files,modes,links};}
async function consumer(t,ssh){
 const f=createRepository();t.after(f.close);let conn;
 if(ssh){const server=await startSSHServer();t.after(()=>server.close());conn=new SSHConnection(server.options);conn.on('error',()=>{});await conn.connect();t.after(()=>conn.disconnect());}else{conn=new NativeRepositoryConnection();t.after(()=>conn.close());}
 const api=new PartialChanges(conn),file="目录/中文 '\"$()\\\n.txt",before='\ufefftop\r\nold',after='\ufefftop\r\nnew';f.write(file,before);f.git('add','--',file);f.git('commit','-qm','partial text');f.write(file,after);const head=f.git('rev-parse','HEAD'),rows=[];
 const preview=await api.preview(f.repo,file,false);assert(preview.revision,preview.unavailableReason);const hunks=parsePatchHunks(preview.diff),selection={lines:hunks.flatMap(h=>h.rows.filter(r=>r.kind==='add').map(r=>r.index))},beforeRead=snapshot(f.root);
 const frozenExpected=frozen().select(before,frozen().parse(preview.diff),new Set(selection.lines),false);assert.equal(frozenExpected,before+'\nnew');assert.deepEqual(snapshot(f.root),beforeRead);
 await api.apply(f.repo,{file,action:'stage',revision:preview.revision,selection});assert.equal(f.git('show',':'+file),frozenExpected);assert.equal(fs.readFileSync(path.join(f.repo,file),'utf8'),after);assert.equal(f.git('rev-parse','HEAD'),head);rows.push({label:'stage added line',expected:compact(frozenExpected),actual:compact(f.git('show',':'+file))});
 let p=await api.preview(f.repo,file,true);await api.apply(f.repo,{file,action:'unstage',revision:p.revision,selection:{hunks:[0]}});assert.equal(f.git('show',':'+file),before);assert.equal(fs.readFileSync(path.join(f.repo,file),'utf8'),after);rows.push({label:'unstage all',expected:compact(before),actual:compact(f.git('show',':'+file))});
 p=await api.preview(f.repo,file,false);const stale=p.revision;f.write(file,after+'external');const changed=snapshot(f.root);await assert.rejects(api.apply(f.repo,{file,action:'discard',revision:stale,selection:{hunks:[0]},confirmed:true}),e=>e.statusCode===409);assert.deepEqual(snapshot(f.root),changed);rows.push({label:'stale read rejects without writes',before:changed,after:snapshot(f.root)});
 f.write(file,after);p=await api.preview(f.repo,file,false);await api.apply(f.repo,{file,action:'discard',revision:p.revision,selection:{hunks:[0]},confirmed:true});assert.equal(fs.readFileSync(path.join(f.repo,file),'utf8'),before);assert.equal(f.git('show',':'+file),before);assert.equal(f.git('rev-parse','HEAD'),head);rows.push({label:'discard all',expected:compact(before),actual:compact(fs.readFileSync(path.join(f.repo,file),'utf8'))});
 for(const [label,bytes,reason]of [['invalid UTF8',Buffer.from([0xff,0x80,10]),/UTF-8/],['binary',Buffer.from([0,65,10]),/二进制/],['over limit',Buffer.alloc(limit+1,65),/2 MiB/]]){f.write(file,bytes);const snap=snapshot(f.root);let unavailableReason,error;if(label!=='binary'){await assert.rejects(api.preview(f.repo,file,false),e=>{assert.match(e.message,label==='over limit'?/1 MiB/:reason);error=e.message;return true;});}else{const r=await api.preview(f.repo,file,false);assert.match(r.unavailableReason,reason);assert.equal(r.revision,undefined);unavailableReason=r.unavailableReason;}assert.deepEqual(snapshot(f.root),snap);rows.push({label,bytes:bytes.length,sha256:hash(bytes),unavailableReason,error,snapshotUnchanged:true});}
 const a=new AbortController(),reason=new Error('preabort'),aborted=new PartialReads({signal:(a.abort(reason),a.signal),execGit(){throw Error('Must not dispatch');}});await assert.rejects(aborted.preview(f.repo,file,false),e=>e===reason);rows.push({label:'current consumer connection preabort',dispatches:0});
 proof(ssh?'partial-real-ssh':'partial-real-native',{rows,headAfter:f.git('rev-parse','HEAD'),headBefore:head,boundary:'Actual current preview/apply via native or encrypted loopback SSH. Frozen pure reconstruction predicts stage result; no frozen full apply parity claim. Real writes limited to isolated fixture; actual partial operations are not replayed after unknown. Binary retains ordinary preview without partial revision; malformed UTF8 and oversize text are rejected by ordinary strict-UTF8 / 1 MiB diff fallback.'});
}
test('P0 partial text real native consumer applies expected selected bytes and refuses stale unsupported text',async t=>consumer(t,false));
test('P0 partial text real SSH consumer applies expected selected bytes and refuses stale unsupported text',async t=>consumer(t,true));
test('P0 partial SDK owns editable text resources rejects foreign unsafe calls and exposes no helper RPC',async t=>{
 const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository(),other=createRepository(),state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b45-sdk-'));t.after(f.close);t.after(other.close);t.after(()=>fs.rmSync(state,{recursive:true,force:true}));f.write('tracked.txt','new\n');other.write('tracked.txt','other\n');
 const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),state],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
 try{const init=await child.client.initialize(),resource=(await child.client.registerRepository(f.repo)).resource,second=(await child.client.registerRepository(other.repo)).resource,read=(r=resource,params={file:'tracked.txt',staged:false})=>child.client.readRepository(r,'editableDiff',params),p=await read(),q=await read(second);assert.equal(resource.agentId,init.agentId);assert.match(p.diff,/new/);assert.doesNotMatch(p.diff,/other/);assert.match(q.diff,/other/);
  const rows=[],ownBefore=snapshot(f.root),otherBefore=snapshot(other.root);
  for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}]){await assert.rejects(read(foreign),e=>e.kind==='not-found');rows.push({label:'foreign resource',kind:'not-found'});}
  for(const params of [{file:'../escape',staged:false},{file:'.git/config',staged:false},{file:'tracked.txt',staged:false,path:other.repo}]){await assert.rejects(child.client.request('repositories.read',{resource,kind:'editableDiff',params}),e=>e.kind==='invalid-params');rows.push({label:'invalid params',params,kind:'invalid-params'});}
  for(const method of ['partialChanges.decode','partialChanges.selectedContent','selectedContent','git.execute']){await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');rows.push({method,kind:'unknown-method'});}
  const a=new AbortController();a.abort();await assert.rejects(child.client.readRepository(resource,'editableDiff',{file:'tracked.txt',staged:false},{signal:a.signal}),e=>e.kind==='cancelled');assert.deepEqual(snapshot(f.root),ownBefore);assert.deepEqual(snapshot(other.root),otherBefore);
  const intent={resource,kind:'partialDiff',args:[{file:'tracked.txt',action:'stage',revision:p.revision,selection:{hunks:[0]}}]},request={...intent,revision:await child.client.prepareRepositoryWrite(intent),operationId:randomUUID()};await child.client.writeRepository(request);assert.equal(f.git('show',':tracked.txt'),'new\n');assert.equal(other.git('show',':tracked.txt'),'original\n');assert.deepEqual(snapshot(other.root),otherBefore);
  proof('partial-sdk',{resource,second,preview:p,otherPreview:q,rows,preabort:true,ownBefore,otherBefore,otherAfter:snapshot(other.root),indexAfter:f.git('show',':tracked.txt'),boundary:'Actual stdio SDK editableDiff and partialDiff consumers, owning resource and preabort. Mutation crash unknown and no automatic replay tested in separate task-journal companions; pure helpers have no standalone RPC or cancellation contract.'});
 }finally{await child.close();}
});
