import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(base, '../../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(base, file)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = file => hash(fs.readFileSync(file));
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
const current = file => path.join(root, file);
const regression = read('replay-02/result.json');
check('final regression, exact test totals and logs', () => {
  assert.equal(regression.result, 'passed'); assert.equal(regression.p0Deductions, 0); assert.equal(regression.releaseEligible, false);
  assert.equal(regression.policy, 'mac-arm64-local-2026-11-08');
  assert.deepEqual(regression.steps.map(s => s.name), ['build','native-build','writes-terminals-migration-boundaries','update-rollback','package','packaged-agent','encrypted-ssh']);
  for (const step of regression.steps) {
    assert.equal(step.status, 0); assert.equal(step.signal, null);
    assert.equal(digest(path.join(base, 'replay-02', step.log.path)), step.log.sha256);
  }
  for (const [name, count] of [['writes-terminals-migration-boundaries',44],['update-rollback',33]]) {
    const log = fs.readFileSync(path.join(base, 'replay-02', name + '.log'), 'utf8');
    assert.match(log, new RegExp('# tests ' + count + '\\n')); assert.match(log, new RegExp('# pass ' + count + '\\n'));
    for (const label of ['fail','cancelled','skipped','todo']) assert.match(log, new RegExp('# ' + label + ' 0\\n'));
  }
  const ssh = fs.readFileSync(path.join(base, 'replay-02/encrypted-ssh.log'), 'utf8');
  for (const fact of ['cross-host rejection', 'interrupted write not replayed', 'reconnect receipt', 'Isolated SSH acceptance passed']) assert(ssh.includes(fact));
});
check('sealed current regression inputs unchanged', () => {
  for (const [file, expected] of Object.entries(read('replay-02/source-before.json').inputs)) assert.equal(digest(current(file)), expected, file);
});
check('packaged current output maps to tested package manifest', () => {
  const manifest = read('replay-02/package-manifest.json');
  assert.equal(manifest.dirty, true); assert.equal(manifest.sourceSha, regression.sha); assert.equal(manifest.target, 'darwin-arm64');
  for (const [file, expected] of Object.entries(manifest.files)) {
    const m = file.match(/^node_modules\/@alune\/(agent|agent-client|protocol|domain)\/(dist\/.+|bin\/.+|package.json)$/);
    if (m) assert.equal(digest(current('packages/' + m[1] + '/' + m[2])), expected, file);
  }
});
function tree(directory) {
  const result = {};
  function visit(at, prefix = '') {
    for (const e of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at,e.name), name = prefix + e.name;
      if (e.isDirectory()) visit(file,name+'/');
      else if (e.isFile()) result[name] = digest(file);
      else if (e.isSymbolicLink()) result[name] = { link: fs.readlinkSync(file) };
      else assert.fail(file);
    }
  }
  visit(directory); return result;
}
const native = read('native-03/proof.json'), nr = read('native-03/node-result.json'), er = read('native-03/electron-result.json');
check('actual released modules and native full credential recovery', () => {
  assert.equal(native.result, 'passed'); assert.equal(native.head, regression.sha);
  assert.equal(native.artifact.filesComparedToReadOnlyImage, 523);
  assert.equal(Object.keys(read('native-03/released-files.json')).length, 523);
  for (const [dir, expected] of Object.entries(native.currentInputs)) assert.deepEqual(tree(current(dir)), expected, dir);
  for (const [file, expected] of Object.entries(native.inputs)) assert.equal(digest(current('apps/desktop/scripts/' + file)), expected, file);
  assert.equal(nr.result, 'passed'); assert.equal(nr.nativeBackend, 'keychain'); assert.equal(nr.imported.hosts, 2); assert.equal(nr.imported.repositories, 2);
  assert.equal(nr.imported.tokens, 1); assert.equal(nr.imported.bindings, 1); assert.equal(nr.imported.documents, 4);
  for (const key of ['sourceUnchanged','gitUnchanged','duplicateWithoutDecryption','missingDecryptAuthorityRefused','wrongRecoveryPhraseUnchanged','originalKeyAndIdentityLost','workspaceRestored','freshNativeKey']) assert.equal(nr[key], true, key);
  assert.deepEqual(nr.recoveredCredentialKinds, ['ssh-password','key-passphrase','token','ai-key','proxy-password']);
  assert.equal(er.result, 'passed'); assert.equal(er.privateDecryptions, 3);
  for (const key of ['releasedModules','safeStorageAvailable','completeSourceBackupByteVerified','restoredReleasedStoresDecrypt']) assert.equal(er[key], true, key);
  const cleanup = read('native-03/execution.json'); assert.equal(cleanup.status, 0);
  for (const value of Object.values(cleanup.cleanup)) assert.equal(value, true);
  assert.equal(digest(path.join(base,'native-03',cleanup.log.path)),cleanup.log.sha256);
});
const live = read('live-update-02/proof.json'), rollback = read('native-rollback-01/result.json');
check('live production download, native staging and released payload rollback', () => {
  assert.equal(live.result, 'passed'); assert.equal(live.sourceUnchanged, true); assert.equal(live.scratchRemoved, true);
  assert.equal(live.driverSha256,digest(current('apps/desktop/scripts/critical-live-mac-update.mjs')));
  for (const [file, expected] of Object.entries(live.inputs)) assert.equal(digest(current('apps/desktop/src/' + file)),expected,file);
  assert.equal(live.downloaded.bytes,157111828); assert.equal(live.downloaded.sha256,native.artifact.dmgSha256);
  assert.equal(live.states.find(s => s.stage === 'native-mounted-and-staged').asarSha256,native.artifact.asarSha256);
  assert.equal(live.requests[0].status,200);
  for (const request of live.requests) { assert.equal(new URL(request.url).search,''); assert.equal(new URL(request.url).hash,''); }
  assert.equal(rollback.result,'passed'); assert.equal(rollback.stagedAsarSha256,native.artifact.asarSha256);
  for (const key of ['deliberateFirstLaunchRefusal','restoredBinaryByteIdentical','retainedSettingsUnchanged','restoredOriginalActuallyStartedViaOpen']) assert.equal(rollback[key],true,key);
  for (const [file, expected] of Object.entries(rollback.inputHashes)) assert.equal(digest(current('apps/desktop/src/' + file)),expected,file);
  assert.equal(fs.readFileSync(path.join(base,'native-rollback-01/attempted-versions.txt'),'utf8'),'0.11.0\n0.10.0\n');
  assert.equal(read('native-rollback-01/restored-startup.json').version,'0.10.0');
  assert.equal(read('native-rollback-01/execution.json').passed,true);
});
let preserved = 0; const intentional = [];
check('all earlier evidence and pre-existing business sources preserved', () => {
  const before = read('preservation-before.json');
  const expectedChanges = new Set(['docs/acceptance/issue-257-258/README.md']);
  for (const [file, expected] of Object.entries(before.files)) {
    const actual = digest(current(file));
    if (expectedChanges.has(file)) { assert.notEqual(actual, expected.sha256); intentional.push({ file, before: expected.sha256, after: actual }); }
    else { assert.equal(actual, expected.sha256,file); preserved++; }
  }
  assert.equal(preserved, 9236); assert.equal(intentional.length,1);
});
check('no accidental P0 deductions', () => {
  const remaining = current('docs/acceptance/issue-257-258/batch-56-commit-files-service-20261117/replay-01/remaining-entries.json');
  assert.equal(digest(remaining),read('preservation-before.json').files[path.relative(root,remaining)].sha256);
});
const archive = tree(base);
for (const file of ['archive.json','verification.json']) delete archive[file];
fs.writeFileSync(path.join(base,'archive.json'),JSON.stringify(archive,null,2)+'\n');
const report = { result:'passed', checks, preservedUnchanged:preserved, intentionalChanges:intentional, archivedFiles:Object.keys(archive).length,
  p0Deductions:0, remainingP0Entries:510, releaseEligible:false,
  pendingApplicationGates:['installed-upgrade-rollback','darwin-arm64:native-update'],
  historicalFullPreservationVerified:false };
fs.writeFileSync(path.join(base,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
