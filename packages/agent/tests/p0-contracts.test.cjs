// Paired direct helper assertions against immutable P0 source, not stale dist.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p0-direct-'));
after(() => fs.rmSync(frozen, { recursive: true, force: true }));
const archive = execFileSync('git', ['archive','3c05f640fcc1a04c864e47bfc2880483ad48c984','packages/ssh-client/src','packages/shared/src'], { cwd: root, maxBuffer:32*1024*1024 });
execFileSync('tar',['-xf','-','-C',frozen],{input:archive});
const cache = new Map(), nativeRequire = createRequire(__filename);
function oldModule(name, source = path.join(frozen,'packages/ssh-client/src/index.ts')) {
  let file;
  if (name === '@alune/shared') file = path.join(frozen,'packages/shared/src/index.ts');
  else if (name.startsWith('.')) {
    const base = path.resolve(path.dirname(source),name);
    file = [base+'.ts',path.join(base,'index.ts')].find(f=>fs.existsSync(f));
    if(!file) throw Error('Missing immutable baseline input: '+base);
  } else return nativeRequire(name);
  if(cache.has(file)) return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.compileFunction(output,['require','module','exports','__filename','__dirname'],{filename:file})((name)=>oldModule(name,file),module,module.exports,file,path.dirname(file));
  return module.exports;
}
const old = name => oldModule('./'+name);
const next = name => require('../dist/modules/git/'+name);
const ssh = require('../dist/adapters/ssh/connection-manager');
const outcome = (fn,args) => { try { return {value:fn(...structuredClone(args))}; } catch(e) { return {error:e.constructor.name,message:e.message,statusCode:e.statusCode,code:e.code}; } };
function parity(oldFn,newFn,samples){for(const args of samples)assert.deepEqual(outcome(newFn,args),outcome(oldFn,args),JSON.stringify(args));}

test('P0 direct path and destructive-request validators preserve frozen result and error contracts', () => {
  const paths=[null,undefined,1,'','a','nested/中文 空格 $ [*].txt','../a','a/../b','a//b','a/.git/config','/absolute','C:/absolute','a\0b'];
  parity(old('new-file-deletion').validateNewFilePath,next('new-file-deletion').validateNewFilePath,paths.map(v=>[v]));
  parity(old('discard-changes').validateDiscardChangesRequest,next('discard-changes').validateDiscardChangesRequest,
    [[],['a'.repeat(64),'all'],['b'.repeat(64),'tracked'],['f'.repeat(63),'all'],['F'.repeat(64),'all'],['a'.repeat(64),'other'],[null,'all']]);
  parity(old('repository-files').validateRepositoryPath,next('repository-files').validateRepositoryPath,
    paths.filter(v=>typeof v==='string').flatMap(v=>[['/repo',v,false],['/repo',v,true]]));
  for(const [module,name] of [['new-file-deletion','NewFileDeletionError'],['discard-changes','DiscardChangesError'],['partial-changes','PartialChangesError'],['diff-images','DiffImageError'],['staged-changes','StagedChangesError'],['conflict-resolution','ConflictResolutionError']]){
    const Old=old(module)[name], New=next(module==='conflict-resolution'?'conflict-resolution-writes':module)[name];
    assert.equal(typeof Old,'function');assert.equal(typeof New,'function');
    for(const args of [['fixture'],['fixture',403]]){
      const a=new Old(...args),b=new New(...args); assert(b instanceof Error);
      assert.deepEqual({name:b.constructor.name,message:b.message,statusCode:b.statusCode},{name:a.constructor.name,message:a.message,statusCode:a.statusCode});
    }
  }
});

test('P0 direct porcelain and blame parsers preserve literal paths, rename, conflict and commit fields', () => {
  const head='a'.repeat(40);
  parity(old('git-status').parseStatus,next('git-status').parseStatus,[
    [''],['# branch.head main\0# branch.oid '+head+'\0# branch.upstream origin/main\0# branch.ab +2 -3\0? 空 格\nfile\0! ignored/\0'],
    ['1 MM N... 100644 100644 100644 '+head+' '+head+' file\0'],
    ['2 R. N... 100644 100644 100644 '+head+' '+head+' R100 新名\0旧名\0'],
    ['u UU N... 100644 100644 100644 100644 '+head+' '+head+' '+head+' conflict\0'],
    ['1 .M SCMU 160000 160000 160000 '+head+' '+head+' submodule\0'],
  ]);
  const blame=`${head} 1 1 1\nauthor Fixture\nauthor-mail <fixture@example.invalid>\nauthor-time 1700000000\nauthor-tz +0800\ncommitter Fixture\ncommitter-mail <fixture@example.invalid>\ncommitter-time 1700000001\ncommitter-tz +0800\nsummary literal summary\nfilename source.ts\n\tconst x = 1;\n`;
  parity(old('git-blame').parseBlame,next('git-blame').parseBlame,[[''],[blame],[blame+blame.replace('1 1 1','2 2 1').replace('const x = 1;','中文 literal')]]);
});

test('P0 direct shell quoting, repository normalization, SSH config parsing and output limits match frozen values', () => {
  for(const name of ['isWindowsPath','quotePosixArgument']) parity(old('git-shell')[name],next('git-shell')[name],['','/tmp/repo','C:/repo','C:\\repo','//server/share',"a ' $HOME `literal`\n中文",'back\\slash'].map(v=>[v]));
  parity(old('repository-path').normalizeRepositoryPath,next('repository-path').normalizeRepositoryPath,['','/a/../b','//server/share/repo/../b','C:/repo/./child','/repo/back\\slash'].map(v=>[v]));
  parity(old('repository-path').joinRepositoryPath,next('repository-path').joinRepositoryPath,[['/repo','a','..','中文'],['//server/share','a'],['C:/repo','a'],['/repo','back\\slash']]);
  const file=path.join(frozen,'synthetic-ssh-config');fs.writeFileSync(file,'# fixture\nHost first\n HostName first.invalid\n User one\n Port 2222\n IdentityFile ~/synthetic-never-read\nHost ignored\n User no-host\nHost second\n HOSTNAME second.invalid\n USER two\n');
  assert.deepEqual(ssh.parseSSHConfig(file),old('connection-manager').parseSSHConfig(file));
  assert.deepEqual(ssh.parseSSHConfig(file+'.absent'),{});
  assert.equal(next('git-commands').DIFF_PREVIEW_MAX_BYTES,old('git-commands').DIFF_PREVIEW_MAX_BYTES);
  assert.equal(next('git-commands').DIFF_PREVIEW_MAX_BYTES,1024*1024);
  const Old=old('connection-manager').CommandOutputLimitError,New=ssh.CommandOutputLimitError;
  assert.equal(new New(1024).message,new Old(1024).message);assert(new New(1024) instanceof Error);
});

test('P0 pool events and replacement/removal cannot describe an obsolete connection', () => {
  function exercise(Pool){
    const pool=new Pool(),events=[];
    for(const event of ['connection:connecting','connection:connected','connection:disconnected','connection:error'])pool.on(event,(...args)=>events.push([event,...args.map(v=>v instanceof Error?v.message:v)]));
    const options={host:'synthetic.invalid',username:'fixture',password:'synthetic-secret-never-sent'};
    const a=pool.createConnection('a',options);assert.equal(pool.getConnection('a'),a);
    for(const event of ['connecting','reconnecting','connect','disconnect'])a.emit(event);
    a.emit('error',Error('controlled error'));
    const b=pool.createConnection('a',options);assert.notEqual(a,b);a.emit('connect');a.emit('error',Error('late old error'));b.emit('connect');
    const second=pool.createConnection('b',options);pool.removeConnection('a');b.emit('connect');assert.equal(pool.getConnection('a'),undefined);
    assert.equal(pool.getConnection('b'),second);pool.disconnectAll();second.emit('disconnect');assert.equal(pool.getConnection('b'),undefined);
    return events;
  }
  const events=exercise(ssh.SSHConnectionPool);
  assert.deepEqual(events,exercise(old('connection-manager').SSHConnectionPool));
  assert.deepEqual(events,[['connection:connecting','a'],['connection:connecting','a'],['connection:connected','a'],['connection:disconnected','a'],['connection:error','a','controlled error'],['connection:connected','a']]);
});

test('P0 SSH task holds, explicit config, connected guard and reconnect timers match without network or real key reads', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for(const Connection of [old('connection-manager').SSHConnection,ssh.SSHConnection]){
    const connection=new Connection({host:'synthetic.invalid',username:'fixture',password:'synthetic-never-sent'});
    assert.equal(connection.activeTasks,0);const a=connection.holdTask(),b=connection.holdTask();assert.equal(connection.activeTasks,2);a();a();assert.equal(connection.activeTasks,1);b();assert.equal(connection.activeTasks,0);
    assert.deepEqual(connection._buildConnectConfig(),{host:'synthetic.invalid',port:22,username:'fixture',readyTimeout:20000,keepaliveInterval:15000,keepaliveCountMax:3,password:'synthetic-never-sent'});
    assert.throws(()=>connection._ensureConnected(),/not established/);
    const fake={};connection.client=fake;connection._connected=true;assert.equal(connection._ensureConnected(),fake);connection.client=null;connection._connected=false;
    let connects=0,reconnecting=0;connection.connect=async()=>{connects++;};connection.on('reconnecting',()=>reconnecting++);
    connection._scheduleReconnect();connection._cancelReconnect();t.mock.timers.tick(5000);assert.equal(connects,0);
    connection._scheduleReconnect();connection._scheduleReconnect();t.mock.timers.tick(4999);assert.equal(connects,0);t.mock.timers.tick(1);assert.equal(connects,1);assert.equal(reconnecting,1);connection._cancelReconnect();
  }
});

test('P0 direct channel open, pump and close retain FIFO reservations and never execute queued work after shutdown', () => {
  for(const Queue of [old('channel-queue').SSHChannelQueue,require('../dist/adapters/ssh/channel-queue').SSHChannelQueue]){
    const queue=new Queue(),opens=[],results=[],channels=[];
    for(let i=0;i<6;i++)queue.open(done=>{opens.push(i);const channel=new EventEmitter();channels.push(channel);done(undefined,channel);},channel=>channel.emit('close'),(error,channel)=>results.push(error?error.message:channels.indexOf(channel)));
    assert.deepEqual(opens,[0,1,2,3]);assert.equal(queue.size,6);queue.pump();assert.deepEqual(opens,[0,1,2,3]);
    channels[0].emit('close');assert.deepEqual(opens,[0,1,2,3,4]);assert.equal(queue.size,5);
    queue.close(Error('controlled shutdown'));queue.pump();assert.deepEqual(opens,[0,1,2,3,4]);assert.equal(results.at(-1),'controlled shutdown');
    queue.open(()=>{throw Error('must not open');},()=>{},error=>results.push(error.message));assert.equal(results.at(-1),'controlled shutdown');
    for(const channel of channels)channel.emit('close');assert.equal(queue.size,0);
  }
});

test('P0 direct SFTP helper calls preserve literal paths, returned bytes, writes, stats and errors', async () => {
  for(const Connection of [old('connection-manager').SSHConnection,ssh.SSHConnection]){
    const connection=new Connection({host:'synthetic.invalid',username:'fixture',password:'synthetic-never-sent'}),calls=[];
    const data=Buffer.from('中文\nraw\u0000text'),handle=Buffer.from('handle');let closes=0;
    const sftp={
      readdir(p,done){calls.push(['readdir',p]);done(null,[{filename:'literal'}]);},
      stat(p,done){calls.push(['stat',p]);done(null,{size:12});},
      open(p,mode,done){calls.push(['open',p,mode]);done(null,handle);},
      read(h,b,o,l,position,done){assert.equal(h,handle);const size=data.copy(b,o,position,position+l);done(null,size,b);},
      close(h,done){assert.equal(h,handle);closes++;done();},
      createWriteStream(p){calls.push(['write',p]);const stream=new EventEmitter();stream.end=value=>{calls.push(['content',value]);queueMicrotask(()=>stream.emit('close'));};return stream;},
    };
    connection.withSftp=operation=>operation(sftp);
    assert.deepEqual(await connection.readDir("dir ' [x]"),[{filename:'literal'}]);
    assert.deepEqual(await connection.stat('nested/file'),{size:12});
    assert.equal(await connection.readFile('literal\nfile'),data.toString('utf8'));assert.equal(closes,1);
    await connection.writeFile('target', 'literal $HOME\n中文');
    assert.deepEqual(calls,[['readdir',"dir ' [x]"],['stat','nested/file'],['open','literal\nfile','r'],['write','target'],['content','literal $HOME\n中文']]);
    sftp.readdir=(_p,done)=>done(Error('readdir failure'));await assert.rejects(connection.readDir('x'),/readdir failure/);
    sftp.stat=(_p,done)=>done(Error('stat failure'));await assert.rejects(connection.stat('x'),/stat failure/);
    sftp.read=(_h,_b,_o,_l,_p,done)=>done(Error('read failure'));await assert.rejects(connection.readFile('x'),/read failure/);assert.equal(closes,2);
    sftp.createWriteStream=()=>{const stream=new EventEmitter();stream.end=()=>queueMicrotask(()=>stream.emit('error',Error('write failure')));return stream;};
    await assert.rejects(connection.writeFile('x','bytes'),/write failure/);
  }
});

test('P0 direct SSH channel primitives and forwarding cleanup preserve command, callbacks and owned resources', async () => {
  for(const Connection of [old('connection-manager').SSHConnection,ssh.SSHConnection]){
    const connection=new Connection({host:'synthetic.invalid',username:'fixture',password:'synthetic-never-sent'});
    const stream=new EventEmitter();stream.stderr=new EventEmitter();stream.close=()=>stream.emit('close');
    const sftp=new EventEmitter();sftp.end=()=>sftp.emit('close');
    const calls=[];
    connection.client={exec(command,done){calls.push(['exec',command]);done(undefined,stream);},sftp(done){calls.push(['sftp']);done(undefined,sftp);},removeListener(name,listener){calls.push(['removeListener',name,listener]);},unforwardIn(host,port,done){calls.push(['unforward',host,port]);done();}};
    connection._connected=true;
    await new Promise((resolve,reject)=>connection._exec("printf 'literal $HOME'",(error,channel)=>{if(error)return reject(error);assert.equal(channel,stream);resolve();}));stream.emit('close');
    await new Promise((resolve,reject)=>connection._sftp((error,channel)=>{if(error)return reject(error);assert.equal(channel,sftp);resolve();}));sftp.emit('close');
    const controller=new AbortController();controller.abort(Error('cancel before open'));
    connection._exec('must never execute',(error)=>assert.match(error.message,/cancel before open/),controller.signal);
    assert.deepEqual(calls,[['exec',"printf 'literal $HOME'"],['sftp']]);
    const listener=()=>{};connection.forwardListener=listener;connection.forwardPort=1234;
    connection.bridge={close(){calls.push(['bridge close']);}};
    connection.forwardSockets.add({destroy(){calls.push(['socket destroyed']);}});
    connection.clearForwarding();
    assert.deepEqual(calls.slice(2),[['removeListener','tcp connection',listener],['unforward','127.0.0.1',1234],['bridge close'],['socket destroyed']]);
    for(const name of ['forwardListener','forwardPort','bridge','forwardAttempt'])assert.equal(connection[name],undefined);
    assert.equal(connection.forwardSockets.size,0);
  }
});

test('P0 direct SFTP chunk generator waits for close on exhaustion, error and early consumer return', async () => {
  for(const read of [old('sftp-file').readSftpChunks,next('sftp-file').readSftpChunks]){
    for(const mode of ['complete','error','early']){
      const events=[];const handle=Buffer.from('fixture');const payload=Buffer.alloc(65540,65);
      const sftp={open(file,flags,done){events.push(['open',file,flags]);done(null,handle);},read(h,buffer,offset,length,position,done){assert.equal(h,handle);events.push(['read',position]);if(mode==='error')return done(Error('controlled read failure'));done(null,payload.copy(buffer,offset,position,position+length),buffer);},close(h,done){assert.equal(h,handle);events.push(['close']);queueMicrotask(done);}};
      const consume=async()=>{const chunks=[];for await(const chunk of read(sftp,'literal path')){chunks.push(chunk);if(mode==='early')break;}events.push(['settled']);return Buffer.concat(chunks);};
      if(mode==='error')await assert.rejects(consume(),/controlled read failure/);
      else assert.deepEqual(await consume(),mode==='early'?payload.subarray(0,65536):payload);
      assert.equal(events.filter(e=>e[0]==='close').length,1);
      if(mode!=='error')assert.deepEqual(events.slice(-2),[['close'],['settled']]);
    }
  }
});

test('P0 direct signature config reads preserve exact bool flags, missing values and command errors', async () => {
  for(const Signing of [old('git-signing').GitSigning,require('../dist/modules/git/git-signing-writes').GitSigning]){
    const calls=[];let reply={exitCode:0,stdout:'  fixture\n',stderr:''};
    const signing=new Signing({execGit:async(repo,args)=>{calls.push([repo,args]);return reply;}});
    assert.equal(await signing.config('/repo','user.signingkey'),'fixture');
    assert.equal(await signing.config('/repo','commit.gpgsign',true),'fixture');
    assert.deepEqual(calls,[['/repo',['config','--get','user.signingkey']],['/repo',['config','--bool','--get','commit.gpgsign']]]);
    reply={exitCode:1,stdout:'',stderr:''};assert.equal(await signing.config('/repo','missing'),undefined);
    reply={exitCode:128,stdout:'',stderr:'controlled failure'};await assert.rejects(signing.config('/repo','bad'),/无法读取签名配置：controlled failure/);
  }
});
