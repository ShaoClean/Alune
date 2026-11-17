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
  if (process.env.P0_PREVIEW_GUARDS_PROOF_DIR)
    fs.writeFileSync(path.join(process.env.P0_PREVIEW_GUARDS_PROOF_DIR, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function frozen() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = 'packages/ssh-client/src/' + name + '.ts';
    const source = fs.readFileSync(path.join(process.env.P0_PREVIEW_GUARDS_FROZEN, file), 'utf8');
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

const limit = 1024 * 1024;
const pathError = '文件路径必须是仓库内的相对文件路径。';
const limitError = '文件或差异超出预览限制（1 MiB），请在仓库中查看。';
const missingError = '文件已不存在或状态已改变，请刷新仓库状态。';
const permissionError = '无法读取文件：没有读取权限。';
const invalid = ['', '/', '/file', 'a\0b', '.', '..', './a', '../a', 'a/../b', 'a/./b', 'a//b', 'a/', '.git', '.GIT/config', 'a/.GiT/objects'];
const valid = ['a', '-option', '中文/空 格', "quote'\"$()\\\nfile", 'a/.github/config', '.gitignore', '..name', 'C:\\file', 'a:b'];

test('P0 preview guards frozen and current path validation rejects forbidden segments before any transport', async () => {
  const rows=[];
  for (const [version,Klass] of versions()) {
    let calls=0;
    const api=new Klass({execGit(){calls++;throw Error('Unexpected Git');},withSftp(){calls++;throw Error('Unexpected files');}});
    for (const file of invalid) {
      assert.throws(()=>api._validateFilePath(file),{message:pathError});
      await assert.rejects(api.diff('/repo',{file}),{message:pathError});
    }
    for (const file of valid) assert.equal(api._validateFilePath(file),undefined);
    for (const file of ['a\\b','a:b','C:\\file'])
      await assert.rejects(api.diff('C:/repo',{file}),{message:'Windows 仓库中的文件路径必须使用 / 分隔，不能包含反斜杠或冒号。'});
    assert.equal(calls,0);rows.push({version,rejected:invalid,acceptedInternal:valid,transportCalls:calls});
  }
  proof('preview-path-matrix',{rows,boundary:'String-only internal POSIX segment validation; Windows additional check belongs to diff. No symlink containment or standalone authorization claim.'});
});
function scriptedFiles({root='/canonical/repo',symbolic=false,file=true,size=0,failAt,reason}={}) {
  const trace=[],handle=Buffer.from('handle');
  const sftp={};
  const args={realpath:['/input/repo'],lstat:[root.replace(/\/$/,'')+'/literal.txt'],open:[root.replace(/\/$/,'')+'/literal.txt','r'],close:[handle]};
  for(const name of ['realpath','lstat','open','close']) sftp[name]=function(...actual) {
    assert.equal(this,sftp,'Callback methods must keep receiver');const cb=actual.pop();
    assert.deepEqual(actual,args[name]);trace.push({name,args:actual.map(v=>Buffer.isBuffer(v)?v.toString():v)});
    const result=name==='realpath'?root:name==='lstat'?{size,isFile:()=>file,isSymbolicLink:()=>symbolic}:name==='open'?handle:undefined;
    queueMicrotask(()=>cb(name===failAt?reason:null,result));
  };
  return {trace,connection:{withSftp(operation){return operation(sftp);},execGit(){throw Error('No Git in file helper');}}};
}
test('P0 preview guards frozen and current file checks enforce lstat type size read-only handle and exact error semantics', async () => {
  const rows=[];
  for(const [version,Klass] of versions()) {
    for(const size of [0,limit-1,limit]) {
      const f=scriptedFiles({size});await new Klass(f.connection)._checkPreviewFile('/input/repo','literal.txt');
      assert.deepEqual(f.trace.map(x=>x.name),['realpath','lstat','open','close']);rows.push({version,size,trace:f.trace});
    }
    for(const root of ['/canonical/repo/','C:/canonical/repo']) {
      const f=scriptedFiles({root});await new Klass(f.connection)._checkPreviewFile('/input/repo','literal.txt');assert.equal(f.trace.length,4);
    }
    const large=scriptedFiles({size:limit+1});await assert.rejects(new Klass(large.connection)._checkPreviewFile('/input/repo','literal.txt'),{message:limitError});assert.equal(large.trace.length,2);
    const dir=scriptedFiles({file:false});await assert.rejects(new Klass(dir.connection)._checkPreviewFile('/input/repo','literal.txt'),{message:'仅支持预览普通文件或符号链接。'});assert.equal(dir.trace.length,2);
    const link=scriptedFiles({symbolic:true,file:false,size:limit+1});await new Klass(link.connection)._checkPreviewFile('/input/repo','literal.txt');assert.equal(link.trace.length,2);
    for(const stage of ['realpath','lstat','open','close']) for(const code of [2,'ENOENT',3,'EACCES','EIO']) {
      const reason=Object.assign(new Error('injected '+stage),{code}),f=scriptedFiles({failAt:stage,reason});
      await assert.rejects(new Klass(f.connection)._checkPreviewFile('/input/repo','literal.txt'),e=>{
        if(code===2||code==='ENOENT')return e.message===missingError;
        if(code===3||code==='EACCES')return e.message===permissionError;
        return e===reason;
      });assert.equal(f.trace.length,['realpath','lstat','open','close'].indexOf(stage)+1);
      rows.push({version,stage,code,trace:f.trace});
    }
    const reason=new Error('withSftp failed');await assert.rejects(new Klass({withSftp(){throw reason;}})._checkPreviewFile('/input/repo','literal.txt'),e=>e===reason);
  }
  proof('preview-file-matrix',{rows,overLimitStopsBeforeOpen:true,nonFilesRejected:true,linksNeverOpened:true,unknownErrorIdentity:true,noDownloadOrRetry:true,boundary:'Injected callback errors test mapping, including close failure; no promised recovery of failed close or TOCTOU atomicity. Actual OS permission behavior independently checked on local Mac.'});
});
function setup(f) {
  f.literal="未跟踪\t'$()\\\nfile.txt";f.write(f.literal,'independent preview text\nsecond line\n');
  f.write('empty.txt','');f.write('exact.bin',Buffer.alloc(limit,97));f.write('large.bin',Buffer.alloc(limit+1,97));
  f.write('denied.txt','private\n');fs.chmodSync(path.join(f.repo,'denied.txt'),0);
  fs.mkdirSync(path.join(f.repo,'directory'));
  fs.writeFileSync(path.join(f.root,'outside.txt'),'outside must not be read\n');
  fs.symlinkSync('../outside.txt',path.join(f.repo,'outside-link'));
  fs.symlinkSync('absent-target',path.join(f.repo,'dangling-link'));
  f.write('tracked.txt','dirty unstaged\n');f.write('staged.txt','staged original\n');f.git('add','--','staged.txt');f.write('staged.txt','different worktree\n');
}
function snapshot(f) {
  const files={},links={},modes={};
  function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})) {
    const p=path.join(d,e.name),r=path.relative(f.root,p);
    if(e.isSymbolicLink())links[r]=fs.readlinkSync(p);else if(e.isDirectory())walk(p);else if(e.isFile()) {
      modes[r]=fs.statSync(p).mode;
      // Denied bytes are known fixture bytes; check with chmod solely outside the measured interval.
      if(e.name==='denied.txt'){assert.equal(fs.statSync(p).mode&0o777,0);files[r]='unreadable-known-fixture';}
      else files[r]=hash(fs.readFileSync(p));
    }
  }}walk(f.repo);files['../outside.txt']=hash(fs.readFileSync(path.join(f.root,'outside.txt')));
  return {head:f.git('rev-parse','HEAD').trim(),refs:f.git('show-ref'),index:hash(fs.readFileSync(path.join(f.repo,'.git/index'))),files,links,modes};
}
function restoreAndCheckDenied(f) {
  const p=path.join(f.repo,'denied.txt');assert.equal(fs.statSync(p).mode&0o777,0);fs.chmodSync(p,0o600);assert.equal(fs.readFileSync(p,'utf8'),'private\n');
}
async function real(t,ssh) {
  const f=createRepository();let remote,local;
  t.after(async()=>{await remote?.close();await local?.close();f.close();});setup(f);
  if(ssh)remote=await connectFixture(f);else local=new NativeRepositoryConnection();
  const connection=remote?.connection??local,before=snapshot(f),rows=[];
  for(const [version,Klass] of versions()) {
    const api=new Klass(connection);
    for(const file of [f.literal,'empty.txt','exact.bin','outside-link','dangling-link'])await api._checkPreviewFile(f.repo,file);
    for(const [file,message] of [['large.bin',limitError],['directory','仅支持预览普通文件或符号链接。'],['missing',missingError],['denied.txt',permissionError]])
      await assert.rejects(api._checkPreviewFile(f.repo,file),{message});
    const result=await api.diff(f.repo,{file:f.literal});
    assert(result.includes('+independent preview text\n+second line\n'));assert(result.includes('new file mode 100644'));
    for(const file of ['large.bin','denied.txt'])await assert.rejects(api.diff(f.repo,{file}),{message:file==='large.bin'?limitError:permissionError});
    assert((await api.diff(f.repo,{file:'dangling-link'})).includes('+absent-target'));
    const link=await api.diff(f.repo,{file:'outside-link'});assert(link.includes('+../outside.txt'));assert(!link.includes('outside must not be read'));
    assert.deepEqual(snapshot(f),before);rows.push({version,result,link,after:snapshot(f)});
  }
  restoreAndCheckDenied(f);
  proof(ssh?'preview-real-ssh':'preview-real-native',{before,rows,unchangedMeasuredSnapshot:true,deniedContentsVerifiedAfterInterval:true,boundary:ssh?'Encrypted loopback SSH/SFTP only; direct helper and public diff, not external host or other OS. Byte checks exclude unreadable file during interval; known bytes independently checked after restoring fixture-only mode.':'Native Git/filesystem only; exact 1 MiB helper boundary, untracked literal path diff and link text. No full directory snapshot atomicity or symlink ancestor containment claim.'});
}
test('P0 preview guards frozen and current native reject oversize directories missing unreadable files and read literal untracked diff without writes',async(t)=>{await real(t,false);});
test('P0 preview guards frozen and current SSH reject oversize directories missing unreadable files and read literal untracked diff without writes',async(t)=>{await real(t,true);});

test('P0 preview guards native cancellation rejects before file access and preserves abort reason',async(t)=>{
  const f=createRepository();t.after(f.close);const c=new AbortController(),reason=new Error('preview cancelled');c.abort(reason);
  const connection=new NativeRepositoryConnection(c.signal);t.after(()=>connection.close());
  for(const [version,Klass] of versions()) {
    await assert.rejects(new Klass(connection)._checkPreviewFile(f.repo,'tracked.txt'),e=>e===reason);
    await assert.rejects(new Klass(connection).diff(f.repo,{file:'tracked.txt'}),e=>e===reason);
  }
  proof('preview-cancellation',{versions:['frozen','current'],preAbortedNative:true,reasonIdentity:true,boundary:'Helpers have no signal argument; transport controls SFTP and Git cancellation. No unconditional remote interruption or write rollback claim.'});
});

test('P0 preview guards actual SDK enforces repository ownership path rejection typed diff cancellation and no helper RPC',async(t)=>{
  const {spawnAgent}=require('@alune/agent-client/node'),f=createRepository(),other=createRepository();t.after(f.close);t.after(other.close);setup(f);other.write('only-other.txt','different repository\n');
  const child=spawnAgent(process.execPath,[path.join(__dirname,'settings-fixture.cjs'),path.join(f.root,'state')],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}});t.after(()=>child.close());
  try {
    const init=await child.client.initialize(),{resource}=await child.client.registerRepository(f.repo),otherResource=(await child.client.registerRepository(other.repo)).resource;
    assert.equal(resource.agentId,init.agentId);const before=snapshot(f);
    const result=await child.client.readRepository(resource,'diff',{file:f.literal});assert(result.includes('+independent preview text\n+second line\n'));
    const second=await child.client.readRepository(otherResource,'diff',{file:'only-other.txt'});assert(second.includes('+different repository'));assert(!second.includes('independent preview text'));
    await assert.rejects(child.client.readRepository(resource,'diff',{file:'only-other.txt'}),e=>e.message.includes(missingError));
    const pathErrors=[];
    for(const file of invalid)await assert.rejects(child.client.readRepository(resource,'diff',{file}),e=>{
      const protocolTextError=!file||file.includes('\0');
      assert.equal(e.kind,protocolTextError?'invalid-params':'unavailable');
      assert.equal(e.message,protocolTextError?'Invalid query text':pathError);
      pathErrors.push({file,kind:e.kind,message:e.message});return true;
    });
    for(const [file,message] of [['large.bin',limitError],['denied.txt',permissionError]])await assert.rejects(child.client.readRepository(resource,'diff',{file}),e=>e.message.includes(message));
    for(const foreign of [{...resource,agentId:randomUUID()},{...resource,resourceId:randomUUID()}])await assert.rejects(child.client.readRepository(foreign,'diff',{file:f.literal}),e=>e.kind==='not-found');
    for(const params of [{file:f.literal,args:['reset','--hard']},{file:f.literal,path:other.repo},{file:123}])await assert.rejects(child.client.request('repositories.read',{resource,kind:'diff',params}),e=>e.kind==='invalid-params');
    for(const method of ['_checkPreviewFile','_validateFilePath','git.execute'])await assert.rejects(child.client.request(method,{}),e=>e.kind==='unknown-method');
    const c=new AbortController();c.abort();await assert.rejects(child.client.readRepository(resource,'diff',{file:f.literal},{signal:c.signal}),e=>e.kind==='cancelled');
    assert.deepEqual(snapshot(f),before);restoreAndCheckDenied(f);
    proof('preview-sdk',{resource,otherResource,result,pathErrors,before,unchanged:true,foreignResourceRejected:true,invalidPathsAndExtraFieldsRejected:true,typedDiffOnly:true,helperRPCRejected:true,preAbortedRequestRejected:true,boundary:'Actual SDK/stdio resource isolation and current diff checks; helper is not a separately exposed RPC. State database outside repository is intentionally used by Agent.'});
  } finally {await child.close();}
});
