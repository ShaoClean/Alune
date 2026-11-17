const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const cp = require('node:child_process');
const { setTimeout: delay, setImmediate: turn } = require('node:timers/promises');
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const { CommandOutputLimitError } = require('../dist/ports/process');
const { createRepository } = require('./helpers/local-repository.cjs');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = v => createHash('sha256').update(v).digest('hex');
const proof = (n, v) => { if (process.env.P0_LOCAL_GIT_PROCESS_PROOF_DIR) fs.writeFileSync(path.join(process.env.P0_LOCAL_GIT_PROCESS_PROOF_DIR,n+'.json'),JSON.stringify(v,null,2)+'\n',{flag:'wx'}); };
let Original;
function frozen() {
  if (Original) return Original;
  const inventory = [];
  function source(file) {
    const text = fs.readFileSync(path.join(process.env.P0_LOCAL_GIT_PROCESS_FROZEN,file),'utf8');
    assert.equal(text,cp.execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
    return { text, ast: ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true) };
  }
  const file='packages/ssh-client/src/local-connection.ts', { text, ast }=source(file);
  const klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='LocalConnection');
  const selected=klass.members.filter(n=>ts.isConstructorDeclaration(n)||n.name?.getText(ast)==='executeGit');assert.equal(selected.length,2);
  const terminate=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='terminateWindowsTree');
  const errors='packages/ssh-client/src/connection-manager.ts', errorSource=source(errors);
  const error=errorSource.ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='CommandOutputLimitError');
  for (const [f,a,nodes] of [[file,ast,[terminate,...selected]],[errors,errorSource.ast,[error]]]) for(const n of nodes)inventory.push({file:f,name:n.name?.getText(a)??'constructor',line:a.getLineAndCharacterOfPosition(n.getStart(a)).line+1,text:n.getText(a),sha256:hash(n.getText(a))});
  const src="import { spawn } from 'node:child_process';\n"+error.getText(errorSource.ast)+'\n'+terminate.getText(ast)+'\nexport class FrozenLocal {\n'+selected.map(n=>n.getText(ast)).join('\n')+'\n}';
  const m={exports:{}};
  vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:id=>{assert.equal(id,'node:child_process');return cp;},process,Buffer,AbortSignal,TextDecoder,Error,setTimeout,clearTimeout},{filename:file});
  Original=m.exports.FrozenLocal;
  proof('local-git-process-frozen-extraction',{baseline,file,fileSha256:hash(text),errorFile:errors,errorFileSha256:hash(errorSource.text),inventory,dependencies:['node:child_process','process','Buffer','AbortSignal','TextDecoder','setTimeout','clearTimeout'],boundary:'Exact unchanged constructor and private executeGit method plus exact output error class and Windows termination helper. Windows branch retained but not executed on darwin. No execGit/proxy/source/export credit.'});
  return Original;
}
const versions=()=>[['frozen',frozen()],['current',NativeRepositoryConnection]];
const execute=(c,p,args,signal,options)=>Promise.resolve().then(()=>c.executeGit(p,args,signal,options));
const baseEnv={GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'};
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b53-process-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const binary=path.join(directory,'git');
  fs.writeFileSync(binary,'#!'+process.execPath+'\n'+String.raw`
const cp=require('node:child_process');
const mode=process.env.P0_PROCESS_MODE;
if(mode==='capture') {process.stdout.write(JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd()}));process.stderr.write('controlled stderr\n');}
else if(mode==='binary')process.stdout.write(Buffer.from([0,255,239,187,191,10]));
else if(mode==='utf8')process.stdout.write(Buffer.from([239,187,191,228,184,173,10]));
else if(mode==='duplex'){process.stdout.write(Buffer.alloc(30,65));process.stderr.write(Buffer.alloc(30,66));}
else if(mode==='stream'){process.stdout.write('one\n');setTimeout(()=>{process.stderr.write('two\n');process.stdout.write('three\n');},20);}
else if(mode==='block'){const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});process.stdout.write(JSON.stringify({pid:process.pid,child:child.pid})+'\n');setInterval(()=>{},1000);}
else if(mode==='exit')process.exit(17);
else throw Error('Unspecified controlled mode');
`,{mode:0o755});
  return {directory,binary,options:mode=>({environment:{...baseEnv,PATH:directory,P0_PROCESS_MODE:mode}})};
}
function snapshot(directory) {
  const files={},modes={},links={};
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name),r=path.relative(directory,p);modes[r]=fs.lstatSync(p).mode;if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile())files[r]=hash(fs.readFileSync(p));}}
  walk(directory);return {files,modes,links};
}

test('P0 local Git frozen and current preserve argv environment validation and spawn failures',async t=>{
  const f=fixture(t),rows=[];
  const removed=['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_PREFIX','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'];
  for(const [version,K] of versions()){
    const c=new K(),sentinel=path.join(f.directory,'not-executed'),p="/literal 中 '\"$()\n[*]",args=['show','--',`$(touch ${sentinel})`,'a\nb','[x]*','--flag=x'];
    const result=await execute(c,p,args,undefined,{environment:{...f.options('capture').environment,...Object.fromEntries(removed.map(k=>[k,'poison'])),P0_CUSTOM:'retained'}});
    assert.equal(result.exitCode,0);assert.equal(result.stderr,'controlled stderr\n');
    const output=JSON.parse(result.stdout);assert.deepEqual(output.args,['--literal-pathspecs','-C',p,...args]);for(const key of removed)assert.equal(output.env[key],undefined);
    assert.equal(output.env.GIT_TERMINAL_PROMPT,'0');assert.equal(output.env.GCM_INTERACTIVE,'Never');assert.equal(output.env.LC_ALL,'C');assert.equal(output.env.P0_CUSTOM,'retained');assert(!fs.existsSync(sentinel));
    const overridden=JSON.parse((await execute(c,p,[],undefined,{environment:{...f.options('capture').environment,LC_ALL:'C.UTF-8',GIT_TERMINAL_PROMPT:'override'}})).stdout);assert.equal(overridden.env.LC_ALL,'C.UTF-8');assert.equal(overridden.env.GIT_TERMINAL_PROMPT,'override');
    for(const [pathValue,argv] of [[null,[]],['nul\0path',[]],['/ok',['nul\0arg']],['/ok',[2]]])await assert.rejects(execute(c,pathValue,argv),e=>e.message==='无效的 Git 路径或参数。');
    await assert.rejects(execute(c,'/ok',[],undefined,{environment:{PATH:path.join(f.directory,'missing')}}),e=>e.message==='未找到 Git。请安装 Git 并确保它在系统 PATH 中，然后重新启动 Alune。');
    const denied=path.join(f.directory,'denied-'+version);fs.mkdirSync(denied);fs.writeFileSync(path.join(denied,'git'),'denied',{mode:0o644});
    await assert.rejects(execute(c,'/ok',[],undefined,{environment:{PATH:denied}}),e=>e.code==='EACCES');
    const exit=await execute(c,'/ok',[],undefined,f.options('exit'));assert.equal(exit.exitCode,17);assert.equal(exit.stdout,'');
    rows.push({version,args:output.args,environmentRemoved:removed,defaults:['0','Never','C'],overridesRetained:true,invalidInputs:4,missingGitMapped:true,eaccesPreserved:true,nonzeroExit:exit.exitCode,sentinelAbsent:true});await c.close?.();
  }
  proof('local-git-process-inputs',{rows,boundary:'Real OS subprocess controlled Git executable; asserts native argv without shell, inherited policy defaults plus explicit override, exact removed Git routing variables, validation and spawn errors. Controlled strings not cross-platform filesystem claims.'});
});

test('P0 local Git frozen and current preserve real Git binary stdin strict UTF8 and output limits',async t=>{
  const f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);const fake=fixture(t),rows=[];
  const bytes=Buffer.from([0,255,10,65]), oid=f.git('hash-object','-w','--stdin'); // empty blob exists before snapshot
  const stored=cp.execFileSync('git',['-C',f.repo,'hash-object','-w','--stdin'],{input:bytes,env:{...process.env,...baseEnv}}).toString().trim();
  const odd="中 '\"$()\n[*]";fs.writeFileSync(path.join(f.repo,odd),'literal content\n');f.git('add','--',odd);f.git('commit','-qm','literal filename');
  const before=snapshot(f.root),otherBefore=snapshot(other.root);
  for(const [version,K] of versions()){
    const c=new K(),stdin=await execute(c,f.repo,['hash-object','--stdin'],undefined,{stdin:bytes,environment:baseEnv});assert.equal(stdin.stdout.trim(),stored);assert.equal(stdin.exitCode,0);
    const blob=await execute(c,f.repo,['cat-file','blob',stored],undefined,{binary:true,environment:baseEnv});assert.equal(blob.stdout,'');assert.deepEqual(Buffer.from(blob.stdoutBytes),bytes);
    const badUtf8=await execute(c,f.repo,['cat-file','blob',stored],undefined,{environment:baseEnv});assert.equal(badUtf8.stdout,bytes.toString('utf8'));
    await assert.rejects(execute(c,f.repo,['cat-file','blob',stored],undefined,{strictUtf8:true,environment:baseEnv}),e=>e.name==='TypeError');
    const bom=await execute(c,f.repo,[],undefined,{...fake.options('utf8'),strictUtf8:true});assert.equal(bom.stdout,'\uFEFF中\n');
    const exact=await execute(c,f.repo,['show','HEAD:'+odd],undefined,{environment:baseEnv});assert.equal(exact.stdout,'literal content\n');
    const otherResult=await execute(c,other.repo,['rev-parse','--show-toplevel'],undefined,{environment:baseEnv});assert.equal(otherResult.stdout.trim(),fs.realpathSync.native(other.repo));
    const failed=await execute(c,f.repo,['definitely-not-a-git-command'],undefined,{environment:baseEnv});assert.notEqual(failed.exitCode,0);assert.match(failed.stderr,/not a git command/);
    const boundary=await execute(c,f.repo,[],undefined,{...fake.options('duplex'),maxOutputBytes:60});assert.equal(boundary.stdout.length+boundary.stderr.length,60);
    await assert.rejects(execute(c,f.repo,[],undefined,{...fake.options('duplex'),maxOutputBytes:59}),e=>e.message==='Command output exceeded the preview limit');
    rows.push({version,stdinOid:stdin.stdout.trim(),binary:Buffer.from(blob.stdoutBytes).toString('hex'),replacement:badUtf8.stdout,strictInvalidRejected:true,bomRetained:true,literalFilename:odd,otherRoot:otherResult.stdout.trim(),failedExit:failed.exitCode,combinedLimit:60,combinedExceededRejected:true});await c.close?.();
  }
  assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);
  proof('local-git-process-real',{rows,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),boundary:'Real native Git across two isolated repositories: read-only object hash, binary/nonbinary/strict decoding, literal filenames and nonzero result. Output limit uses controlled executable with combined stderr/stdout. No SSH/Windows/performance claim.'});
});
async function gone(pid){
  for(let i=0;i<100;i++){try{process.kill(pid,0);const result=cp.spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'});if(result.stdout.trim().startsWith('Z'))return true;}catch(e){if(e.code==='ESRCH')return true;throw e;}await delay(20);}return false;
}

test('P0 local Git frozen and current cancel process groups preserve errors and current close drains',async t=>{
  const f=fixture(t),rows=[];
  for(const [version,K] of versions()){
    for(const source of ['request','connection']){
      const lifetime=new AbortController(),request=new AbortController(),reason=new Error('cancel '+source),c=new K(lifetime.signal);let pids;
      const op=execute(c,'/literal',[],request.signal,{...f.options('block'),onStdout:chunk=>{pids=JSON.parse(chunk);(source==='request'?request:lifetime).abort(reason);}});
      await assert.rejects(op,e=>e===reason);assert(pids);assert(await gone(pids.pid));assert(await gone(pids.child));
      rows.push({version,source,pids,errorIdentity:true,parentStopped:true,childStopped:true});await c.close?.();
    }
    for(const source of ['request','connection']){
      const lifetime=new AbortController(),request=new AbortController(),reason={code:'preabort',source};(source==='request'?request:lifetime).abort(reason);const c=new K(lifetime.signal);let observed=false;
      await assert.rejects(execute(c,'/literal',[],request.signal,{...f.options('capture'),onStdout:()=>{observed=true;}}),e=>e===reason);assert.equal(observed,false);await c.close?.();
    }
    const request=new AbortController(),c=new K();let pid;await assert.rejects(execute(c,'/literal',[],request.signal,{...f.options('block'),onStdout:chunk=>{pid=JSON.parse(chunk);request.abort('non-error');}}),e=>e.message==='Git 操作已取消。');assert(await gone(pid.child));await c.close?.();
  }
  const c=new NativeRepositoryConnection();let pids,ready;const started=new Promise(r=>ready=r);
  const op=c.execGit('/literal',[],undefined,{...f.options('block'),onStdout:chunk=>{pids=JSON.parse(chunk);ready();}});const caught=op.catch(e=>e);await started;await c.close();assert.equal(await caught,c.signal.reason);assert(await gone(pids.pid));assert(await gone(pids.child));
  rows.push({version:'current',source:'close via owned public internal execGit',pids,errorIdentity:true,parentStopped:true,childStopped:true});
  proof('local-git-process-cancellation',{rows,preaborts:4,nonErrorReasons:2,boundary:'Actual darwin process groups with controlled executable and inherited child pipes, request/lifetime cancellation and current connection-owned close. No timeout acceleration in these real cancellation cases; no Windows tree claim.'});
});

test('P0 local Git frozen and current timeout policy and stdin error handling are exact',async t=>{
  const f=fixture(t),rows=[];
  // Use exact method extraction against an EventEmitter process double solely for otherwise slow/error branches.
  // Runtime dependency seam uses original functions; method bodies remain byte exact.
  for(const [version,file,className] of [['frozen',path.join(process.env.P0_LOCAL_GIT_PROCESS_FROZEN,'packages/ssh-client/src/local-connection.ts'),'LocalConnection'],['current',path.join(root,'packages/agent/src/adapters/git/native.ts'),'NativeRepositoryConnection']]){
    const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===className),method=klass.members.find(n=>n.name?.getText(ast)==='executeGit').getText(ast);
    const {EventEmitter}=require('node:events');let timer;const timers=[],signals=[];let child;
    const spawn=(executable,args,options)=>{child=new EventEmitter();for(const k of ['stdout','stderr','stdin'])child[k]=new EventEmitter();child.pid=987654321;child.stdin.end=()=>{};child.kill=signal=>signals.push(signal);return child;};
    const m={exports:{}};vm.runInNewContext(ts.transpileModule('export class Double {\n'+method+'\n}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,spawn,process:{env:process.env,platform:'darwin',kill:(_pid,s)=>signals.push(s)},Buffer,AbortSignal,TextDecoder,Error,CommandOutputLimitError,setTimeout:(fn,ms)=>{const t={fn,ms,cleared:false,unref(){}};timers.push(t);if(ms===300000)timer=t;return t;},clearTimeout:t=>{if(t)t.cleared=true;}});
    const K=m.exports.Double;
    const timed=new K().executeGit('/literal',[]);timer.fn();assert.equal(timers[0].ms,300000);assert.equal(timers[1].ms,1500);timers[1].fn();child.emit('close',null,'SIGKILL');await assert.rejects(timed,e=>e.message==='Git 操作超时，请检查仓库状态后重试。');assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert(timers.every(t=>t.cleared));
    const epipe=new K().executeGit('/literal',[]);child.stdin.emit('error',Object.assign(new Error('closed input'),{code:'EPIPE'}));child.emit('close',0,null);assert.equal((await epipe).exitCode,0);
    const failure=new Error('stdin I/O');const errored=new K().executeGit('/literal',[]);child.stdin.emit('error',failure);child.emit('close',null,'SIGTERM');await assert.rejects(errored,e=>e===failure);
    rows.push({version,methodSha256:hash(method),timeoutMilliseconds:300000,killAfterMilliseconds:1500,signals:['SIGTERM','SIGKILL'],epipeIgnored:true,otherStdinErrorIdentity:true,timersCleared:true});
  }
  proof('local-git-process-policy',{rows,boundary:'Byte-exact AST methods under controlled spawn and timer seam only. Confirms configured 5 minute timeout, escalation, cleanup, EPIPE and error identity. Does not claim a 5 minute wall-clock run or real Windows termination.'});
});

test('P0 local Git current reliable observation waits for acknowledgements and catches callback failures',async t=>{
  const f=fixture(t),rows=[];let release,first;const ready=new Promise(r=>first=r),gate=new Promise(r=>release=r),chunks=[],exits=[],commands=[];
  const c=new NativeRepositoryConnection();let settled=false;
  const op=c.execGit('/literal',[],undefined,{...f.options('stream'),observe:command=>{commands.push(command);return {output:async(stream,bytes)=>{chunks.push({stream,hex:bytes.toString('hex')});if(chunks.length===1){first();await gate;}},exit:async(code,signal)=>{exits.push({code,signal});}};}}).then(value=>{settled=true;return value;});
  await ready;await delay(50);assert.equal(settled,false);assert.equal(chunks.length,1);assert.deepEqual(exits,[]);release();const result=await op;assert.equal(result.stdout,'one\nthree\n');assert.equal(result.stderr,'two\n');assert.deepEqual(exits,[{code:0,signal:null}]);assert.deepEqual(commands,[{executable:'git',args:['--literal-pathspecs','-C','/literal'],cwd:'/literal'}]);await c.close();
  rows.push({kind:'acknowledged output',chunks,exits,commands,pendingUntilAck:true});
  for(const which of ['onStdout','onStderr','observer-output','observer-exit','observer-factory']){
    const c=new NativeRepositoryConnection(),reason=new Error(which),opts=f.options('stream');
    if(which==='onStdout'||which==='onStderr')opts[which]=()=>{throw reason;};else opts.observe=()=>{if(which==='observer-factory')throw reason;return {output:async()=>{if(which==='observer-output')throw reason;},exit:async()=>{if(which==='observer-exit')throw reason;}};};
    await assert.rejects(c.execGit('/literal',[],undefined,opts),e=>e===reason);await c.close();rows.push({kind:which,errorIdentity:true,closeDrained:true});
  }
  proof('local-git-process-observation',{rows,boundary:'Current intentional reliable observation addition: real pipe delivery waits for ack, exit delivered after output, all callback failures reject. Frozen executeGit has no observer contract. Does not credit command-event entries.'});
});

test('P0 local Git actual SDK keeps process helper private and isolates two Agent repository consumers',async t=>{
  const {spawnAgent}=require('@alune/agent-client/node');const f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);const state=fs.mkdtempSync(path.join(os.tmpdir(),'alune-b53-sdk-'));t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
  const agents=['a','b'].map(n=>spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(state,n)],{env:{...process.env,...baseEnv}}));t.after(()=>Promise.all(agents.map(a=>a.close())));
  try{
    const [a,b]=agents,[ia,ib]=await Promise.all(agents.map(a=>a.client.initialize()));assert.notEqual(ia.agentId,ib.agentId);const own=(await a.client.registerRepository(f.repo)).resource,foreign=(await b.client.registerRepository(other.repo)).resource;
    const before=snapshot(f.root),otherBefore=snapshot(other.root);const status=await a.client.readRepository(own,'status',{});assert.equal(status.branch,f.git('symbolic-ref','--short','HEAD').trim());assert.equal(status.worktreeKind,'main');const otherStatus=await b.client.readRepository(foreign,'status',{});assert.equal(otherStatus.worktreeKind,'main');
    for(const [client,r]of[[a.client,foreign],[b.client,own]])await assert.rejects(client.readRepository(r,'status',{}),e=>e.kind==='not-found');
    await assert.rejects(a.client.request('repositories.read',{resource:own,kind:'status',params:{args:['status']}}),e=>e.kind==='invalid-params');
    for(const method of ['executeGit','local.executeGit','execGit','local.execGit'])await assert.rejects(a.client.request(method,{path:other.repo,args:['status']}),e=>e.kind==='unknown-method');
    const cancel=new AbortController();cancel.abort();await assert.rejects(a.client.readRepository(own,'status',{},{signal:cancel.signal}),e=>e.kind==='cancelled');
    assert.deepEqual(snapshot(f.root),before);assert.deepEqual(snapshot(other.root),otherBefore);
    proof('local-git-process-sdk',{agentIds:[ia.agentId,ib.agentId],own,foreign,status,otherStatus,foreignRejected:true,strictParams:true,helperRpcAbsent:true,preabort:true,before,after:snapshot(f.root),otherBefore,otherAfter:snapshot(other.root),boundary:'Actual SDK/stdio consumers execute real native Git; two Agents strict params/resource ownership. No new process RPC. Unknown write/no replay covered by independent companions, not a helper write mutation injection.'});
  }finally{await Promise.all(agents.map(a=>a.close()));}
});
