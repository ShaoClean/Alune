// Fresh full native execution, preserving exact source/build provenance and scope.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadNativeObservation } from './reconcile-ui-evidence.mjs';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { pointerIds, pointerScenario } from './p0-history-pointer-review.mjs';
import { readPolicy } from './acceptance-policy.mjs';
const root=fileURLToPath(new URL("../../../",import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
export const reviewedNative=[
 {scenario:pointerScenario,entries:pointerIds,assertion:'Native pointer down/move/up/lost-capture changes actual graph/detail geometry by over 10px while retaining the exact selected historical commit/file.'},
 {scenario:'a real shallow fetch fails while its isolated upstream is unavailable; inspect unchanged Git state, restore the upstream and explicitly retry to acquire full history without altering HEAD or user edits',entries:['ui-handler:apps/web/src/pages/RepositoryDetailPage.tsx:RepositoryContextNotice.onRefresh:701'],assertion:'The notice retry completes the real shallow fetch after its isolated upstream is restored; actual Git history deepens while HEAD and user edits remain unchanged.'},
 {scenario:'the missing-remote notice opens remote management; add the isolated upstream through its form and preserve the original Git content',entries:['ui-handler:apps/web/src/pages/RepositoryDetailPage.tsx:RepositoryContextNotice.onRemotes:700'],assertion:'The missing-remote notice callback opens the actual remote-management panel; its form adds the exact isolated upstream and preserves the original Git content.'},
];
export function selectNativeRuns(ledger,previous,observation,proof){
 if(!observation.complete)throw Error('Full native write and restore must both pass');
 const known=new Map(ledger.entries.map(r=>[r.id,r]));
 const original=new Set(previous.runs.filter(r=>r.result==='passed').flatMap(r=>r.entries));
 const limitation='Fresh full native Mac arm64 test execution with isolated synthetic data. Signature failure is a repository-scoped command-failure fixture; all other Git commands execute unchanged. Native updater installation is a smoke double. No real credentials, platform-wide release or branch completeness claim.';
 const make=(record,entries,assertion)=>({sha:observation.sha,target:record.platform+'-'+record.arch,scenario:record.scenario,assertion,limitations:limitation,result:'passed',entries,proof});
 const runs=[];
 for(const record of observation.records){
  if(record.sha!==observation.sha||record.platform!=='darwin'||record.arch!=='arm64'||!record.scenario?.trim()||!Array.isArray(record.executed)||!Array.isArray(record.ui))throw Error('Invalid mixed native record');
  for(const id of record.executed)if(!known.has(id))throw Error('Unknown native trace ID');
  const selected=[...new Set(record.executed.filter(id=>original.has(id)&&record.ui.includes(known.get(id).uiBehavior)))];
  if(selected.length)runs.push(make(record,selected,record.scenario));
 }
 const seen=new Set(runs.flatMap(r=>r.entries));
 if([...original].some(id=>!seen.has(id)))throw Error('An original UI association was not actually reasserted');
 for(const review of reviewedNative){
  const matches=observation.records.filter(r=>r.scenario===review.scenario);
  if(matches.length!==1||review.entries.some(id=>!known.has(id)||!matches[0].executed.includes(id)))throw Error('Missing exact reviewed native callback assertion');
  if(review.scenario===pointerScenario){
   const facts=matches[0].facts;assert.equal(facts?.input,'native Electron pointer');assert.match(facts.commit,/^[a-f0-9]{40}$/);
   assert.ok(facts.after.graph>facts.before.graph+10);assert.ok(facts.after.detail<facts.before.detail-10);
  }
  runs.push(make(matches[0],review.entries,review.assertion));
 }
 return runs;
}
export function main(args){
 const [ledgerFile,previousFile,input,output,policyFile]=args;
 if(!policyFile)throw Error('Usage: p0-native-current.mjs LEDGER PREVIOUS NATIVE_DIRECTORY NEW_OUTPUT POLICY');
 const ledger=JSON.parse(fs.readFileSync(ledgerFile)),previous=JSON.parse(fs.readFileSync(previousFile));validateLedger(ledger);
 const observation=loadNativeObservation(input,'8f30e6bcc0a4b7706c192896a73b87dc1a915ed9'),state=observation.provenance;
 const policy=readPolicy(policyFile);
 if(!policy.localProofs||!policy.requiredTargets.includes('darwin-arm64')||state.exitCode!==0||state.inputsStable!==true||state.businessSourceClean!==true||!state.assets?.length)throw Error('Missing successful stable native build/source provenance');
 const allowed=['apps/desktop/src/candidate-history-recovery.cjs','apps/desktop/scripts/smoke.mjs','apps/desktop/scripts/signature-failure-fixture.mjs'];
 assert.deepEqual([...state.fixtureChanges].sort(),[...allowed].sort());
 // Every first-party business/test input outside the three archived fixture
 // changes must be the exact committed source, not a dirty runtime relabelled SHA.
 for(const entry of state.files){
  const bytes=allowed.includes(entry.file)?fs.readFileSync(path.join(input,'fixture-sources',entry.file)):
   execFileSync('git',['show',observation.sha+':'+entry.file],{cwd:root});
  if(hash(bytes)!==entry.sha256)throw Error('Native input differs from archived review: '+entry.file);
 }
 const bytes=JSON.stringify({sha:observation.sha,baseline:ledger.sha,execution:'Fresh complete native write/restore',provenance:state,phases:observation.phases,artifacts:observation.artifacts,records:observation.records,reviewedNative,driverSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))},null,2)+'\n';
 const proof={path:'native-proof.json',sha256:hash(bytes)};
 const runs=selectNativeRuns(ledger,previous,observation,proof);
 const receipts={stage:'after-retirement',sha:observation.sha,baseline:ledger.sha,policy:policy.id,runs};
 const progress=missingProgress(ledger,previous,receipts);
 fs.mkdirSync(output,{recursive:false});fs.writeFileSync(path.join(output,'native-proof.json'),bytes);fs.writeFileSync(path.join(output,'receipts.json'),JSON.stringify(receipts,null,2)+'\n');fs.writeFileSync(path.join(output,'missing-progress.json'),JSON.stringify(progress,null,2)+'\n');
 console.log(JSON.stringify({scenarios:observation.records.length,associated:new Set(runs.flatMap(r=>r.entries)).size,newOriginalGap:progress.summary.newlyAssertedAmongPreviousMissing}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
