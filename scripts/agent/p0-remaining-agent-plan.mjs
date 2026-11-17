import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateBindings, validateLedger } from './p0-test-receipts.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha='8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function agentPlan(ledger,progress){
  const missing=new Set(progress.rows.filter(r=>r.status!=='current-scoped-assertion').map(r=>r.id));
  const bindings=[];
  function ref(file,name,needle=name){
    const lines=fs.readFileSync(path.join(root,file),'utf8').split('\n');
    const indexes=lines.flatMap((s,i)=>s.includes(needle)?[i]:[]);
    if(indexes.length!==1)throw Error('Ambiguous assertion: '+file+':'+needle);
    let i=indexes[0];while(i>=0&&!/^\s*test\(/.test(lines[i]))i--;
    if(i<0||indexes[0]-i>2)throw Error('Missing test declaration '+name);
    return {file,name,line:i+1};
  }
  const test=(module,name,needle)=>ref('packages/agent/tests/'+module+'.test.cjs',name,needle);
  const direct=name=>test('p0-contracts',name);
  function add(module,selectors,tests,assertion,extraLimit=''){
    const file=`packages/ssh-client/src/${module}.ts`;
    const entries=selectors.map(s=>{const [kind,name]=s.split(':');return `${kind}:${file}:${kind==='source'?file:name}`;});
    if(entries.some(id=>!missing.has(id)))throw Error('Not a remaining exact P0 ID: '+entries.filter(id=>!missing.has(id)));
    bindings.push({entries,tests,implementation:[],assertion,limitations:extraLimit+' Exact declared assertions only; source/class associations are scoped to these responsibilities. No inferred helper/constructor/whole-module coverage, real credentials or external production hosts.'});
  }
  const validators=direct('P0 direct path and destructive-request validators preserve frozen result and error contracts');
  add('new-file-deletion',['export:validateNewFilePath','export:NewFileDeletionError'],[validators],'Direct frozen/current validator results and error constructor/message/statusCode match for literal safe paths and invalid type, NUL, absolute, drive, empty, .git and traversal cases.');
  add('discard-changes',['export:validateDiscardChangesRequest','export:DiscardChangesError'],[validators],'Direct frozen/current token and scope validation preserve exact success and error contracts including length, hex case, absent and invalid scopes.');
  for(const [module,name]of [['partial-changes','PartialChangesError'],['diff-images','DiffImageError'],['staged-changes','StagedChangesError'],['conflict-resolution','ConflictResolutionError']])add(module,['export:'+name],[validators],'Direct frozen/current error construction retains Error identity and exact message/default or supplied status fields. Only constructor/error-value contract.');
  add('repository-files',['export:validateRepositoryPath'],[validators],'Direct frozen/current repository path validation compares exact root permission and safe/unsafe input result/error values.');
  const parsers=direct('P0 direct porcelain and blame parsers preserve literal paths, rename, conflict and commit fields');
  add('git-status',['export:parseStatus'],[parsers],'Direct frozen/current porcelain parsing agrees for all explicitly sampled fields, literal newline/Unicode paths, rename origins, unmerged records, submodule flags and empty input.');
  add('git-blame',['export:parseBlame'],[parsers],'Direct frozen/current blame parsers agree for empty, single and repeated-commit porcelain including exact line indexes, content, author and commit fields.');
  const literals=direct('P0 direct shell quoting, repository normalization, SSH config parsing and output limits match frozen values');
  add('git-shell',['export:isWindowsPath','export:quotePosixArgument'],[literals],'Direct frozen/current platform detection and literal POSIX quoting agree for POSIX, drive, UNC, quotes, newline, shell syntax and literal backslashes.');
  add('repository-path',['source','export:normalizeRepositoryPath','export:joinRepositoryPath'],[literals],'Direct frozen/current normalization and joins agree for traversal normalization, UNC shares, drive paths, Unicode and literal POSIX backslashes.');
  add('connection-manager',['export:parseSSHConfig','export:CommandOutputLimitError'],[literals],'Immutable baseline/current SSH config parser produces identical host/user/port/key-path projections from a synthetic file; no identity key is read. Output-limit error message and Error identity agree.');
  add('git-commands',['export:DIFF_PREVIEW_MAX_BYTES'],[literals],'Frozen/current runtime limit is exactly 1 MiB. Constant only, not full preview behavior.');
  const pools=direct('P0 pool events and replacement/removal cannot describe an obsolete connection');
  const poolSelectors=['export:SSHConnectionPool',...['createConnection','getConnection','removeConnection','disconnectAll'].map(n=>'method:SSHConnectionPool.'+n),
    'channel:this.emit:connection:connecting:773','channel:this.emit:connection:connecting:776','channel:this.emit:connection:connected:779','channel:this.emit:connection:disconnected:782','channel:this.emit:connection:error:785'];
  // Channel IDs include their original call expression; retain them literally.
  const file='packages/ssh-client/src/connection-manager.ts';
  const channels=poolSelectors.filter(s=>s.startsWith('channel:')).map(s=>s.replace('channel:',`channel:${file}:`));
  add('connection-manager',poolSelectors.filter(s=>!s.startsWith('channel:')),[pools],'Direct frozen/current pool creation/get/replacement/removal/shutdown preserve exact connection identities and event sequence; late superseded/removed events are ignored. Synthetic connections, no network.');
  bindings.push({...bindings.at(-1),entries:channels,assertion:'All five exact frozen pool event-emission callbacks produce the independently asserted connecting/reconnecting/connected/disconnected/error event sequence and suppress obsolete owners.'});
  const life=direct('P0 SSH task holds, explicit config, connected guard and reconnect timers match without network or real key reads');
  add('connection-manager',['method:SSHConnection.holdTask','method:SSHConnection._buildConnectConfig','method:SSHConnection._ensureConnected','method:SSHConnection._scheduleReconnect','method:SSHConnection._cancelReconnect'],[life],'Direct old/current task accounting is idempotent; explicit synthetic password config contains exact defaults; disconnected guard rejects; timer cancellation and replacement result in exactly one reconnect at 5000ms.');
  const queue=direct('P0 direct channel open, pump and close retain FIFO reservations and never execute queued work after shutdown');
  add('channel-queue',['method:SSHChannelQueue.open','method:SSHChannelQueue.close','method:SSHChannelQueue.pump'],[queue],'Direct old/current queue open and pump retain four reservations, advance FIFO only after close, fail queued work after shutdown and reject all late opens.');
  add('connection-manager',['method:SSHConnection.readDir','method:SSHConnection.readFile','method:SSHConnection.writeFile','method:SSHConnection.stat'],[direct('P0 direct SFTP helper calls preserve literal paths, returned bytes, writes, stats and errors')],'Direct old/current SFTP wrappers preserve literal arguments, exact data/stats and written bytes; injected read/list/stat/write failures propagate and handles close on read failure.');
  add('connection-manager',['method:SSHConnection._exec','method:SSHConnection._sftp','method:SSHConnection.clearForwarding'],[direct('P0 direct SSH channel primitives and forwarding cleanup preserve command, callbacks and owned resources')],'Direct old/current primitives retain exact command and channel identities, reject cancelled opens before execution, and close only owned forwarding listener, port, bridge and sockets.');
  add('sftp-file',['source','export:readSftpChunks'],[direct('P0 direct SFTP chunk generator waits for close on exhaustion, error and early consumer return')],'Direct old/current async generators preserve 65540 exact bytes, bounded chunks and awaited close on full consumption, read error and early return.');
  add('git-signing',['method:GitSigning.config'],[direct('P0 direct signature config reads preserve exact bool flags, missing values and command errors')],'Direct frozen/current config reads send exact bool/non-bool Git arguments; trim output, preserve missing values and propagate nonzero command errors.');
  const signing=test('git-signing','local: SSH signed commit/amend/tag, trust changes, tampering and failure integrity','${kind}: SSH signed commit/amend/tag');
  add('git-signing',['source','export:GitSigning','method:GitSigning.read','method:GitSigning.save','method:GitSigning.signatures'],[signing,test('git-signing','validate inputs before executing Git and retain all Git verification states')],'Direct reads/writes/signature queries use real Git and ephemeral signing keys; signed commit/amend/tag, trust changes, tampering, absent verifier and failed-signing integrity have explicit expected results.');
  add('git-signing',['export:signatureStatus','export:signingFailure'],[test('git-signing','validate inputs before executing Git and retain all Git verification states')],'Direct status-code projection and error advice preserve exact verification-state array, pinentry/agent advice and unrelated errors.');
  const log=test('git-log','all references, parents and exact pagination agree with real Git over more than 150 commits');
  add('git-log',['source','export:readLog','export:GitLogChangedError','export:GitLogOptionsError'],[log,test('git-log','a moved reference or a reference changed during reading never mixes history pages'),test('git-log','query values cannot become shell or Git options; malformed pages are rejected')],'GitReads delegates directly to migrated readLog: actual 150+ commit/ref/parent/cursor results match Git; exact error classes reject stale history and invalid pages without shell execution.');
  const rebase=test('git-interactive-rebase','local: reorder, reword, consecutive squash/fixup and drop use real Git','${mode}: reorder, reword');
  add('interactive-rebase',['source','export:InteractiveRebase','method:InteractiveRebase.state','method:InteractiveRebase.preview','method:InteractiveRebase.start'],[rebase,test('git-interactive-rebase','matches an independently executed native interactive rebase in trees, messages and authors')],'Actual preview/order/messages/trees/authors and cleared session state match independently executed native interactive rebase on disposable local repositories.');
  add('interactive-rebase',['method:InteractiveRebase.control','method:InteractiveRebase.conflict','method:InteractiveRebase.resolve'],[test('git-interactive-rebase','skip continues the plan without applying the conflicting commit'),test('git-interactive-rebase','rejects stale conflict content and rejects paths outside the conflict set')],'Actual conflict/read/resolve/control operations skip a conflicting commit and reject stale/foreign content without changing unrelated paths.');
  const modules=test('git-submodules-lfs','local: nested submodule initialization, state, summaries, sync and open validation','${source}: nested submodule initialization');
  add('submodules',['source','export:GitSubmodules','method:GitSubmodules.list','method:GitSubmodules.update','method:GitSubmodules.resolve'],[modules],'Actual nested local submodule initialization/list/sync/resolve preserves exact path/commit/state projection; traversal, uninitialized opening and dirty overwrite reject.');
  const lfs=test('git-submodules-lfs','local: absent git-lfs, cached images, OID verification and historical versions','${source}: absent git-lfs');
  add('lfs',['source','export:GitLfs','method:GitLfs.status'],[lfs,test('git-submodules-lfs','local: LFS detection excludes ignored untracked files but retains tracked ones','${source}: LFS detection excludes')],'Actual LFS status/detection distinguishes absent Git-LFS and tracked versus ignored paths; cached image previews verify content/OID and historical identity. Only status public responsibility, not inferred internal helpers.');
  const native=test('git-local-connection','local commands use literal argv and bounded, byte-preserving output');
  add('local-connection',['source','export:LocalConnection','method:LocalConnection.execGit','method:LocalConnection.withSftp'],[native,test('git-local-connection','local file and Git transports agree on paths containing native directory aliases')],'Native replacement uses literal argv and exact binary output with bounds/UTF-8 errors, and native file/Git roots agree through direct withSftp. The approved structured-command replacement rejects unstructured shell execution; old execCommand is not credited.');
  add('local-git-proxy',['source','export:withLocalGitProxy'],[test('git-local-git-proxy','local HTTP Git overrides scoped proxy and NO_PROXY without persisting credentials or config'),test('git-local-git-proxy','cancelling a local Git transfer closes its proxy tunnel')],'Real local Git HTTP uses the app proxy despite repository/NO_PROXY overrides, preserves config/credentials and closes a cancelled tunnel. Loopback-only origins.');
  add('proxy-transport',['source','export:connectProxySocket','export:createProxyDispatcher','export:createProxyBridge'],[test('git-proxy-transport','HTTPS proxies reject an untrusted certificate and closed proxies never fall back to direct'),test('git-proxy-transport','bridge preserves old tunnels and uses saved changes for new requests')],'Real loopback proxy sockets/dispatcher/bridge reject untrusted TLS and closed proxies without direct fallback, retain old tunnels and apply saved policy to new requests.');
  add('connection-manager',['method:SSHConnection.connect','method:SSHConnection.prepareGitProxy'],[test('git-proxy-transport','SSH connects through the proxy; forwarding, busy tasks, and disconnect cleanup are distinct'),test('git-proxy-transport','denied forwarding leaves SSH usable and closes the listener')],'Direct real loopback SSH connect and forwarding prove expected connected/ready/denied states and remote listener cleanup; denied forwarding leaves SSH commands usable.');
  const paths=['packages/agent/src','packages/domain/src','packages/protocol/src'];
  const enumerate=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?enumerate(dir+'/'+e.name):/\.(ts|cjs)$/.test(e.name)?[dir+'/'+e.name]:[]);
  const implementations=paths.flatMap(enumerate).concat(enumerate('packages/agent/tests/helpers'));
  for(const binding of bindings)binding.implementation=implementations;
  const testFile='packages/agent/tests/p0-contracts.test.cjs';
  return {schemaVersion:1,sha,reviewedTooling:{[testFile]:hash(fs.readFileSync(path.join(root,testFile)))},bindings};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [ledgerFile,progressFile,output]=process.argv.slice(2);const ledger=JSON.parse(fs.readFileSync(ledgerFile));validateLedger(ledger);const plan=agentPlan(ledger,JSON.parse(fs.readFileSync(progressFile)));validateBindings(ledger,plan);fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({bindings:plan.bindings.length,ids:new Set(plan.bindings.flatMap(r=>r.entries)).size}));
}
