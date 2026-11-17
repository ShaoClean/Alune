// Explicit named component assertions, never whole-file coverage inference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { readPolicy, validProof } from './acceptance-policy.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function componentRuns(ledger,proof,plan,reference){
 if(proof.sha!==plan.sha||proof.baseline!==ledger.sha||plan.baseline!==ledger.sha||proof.provenance?.exitCode!==0||proof.provenance?.inputsStable!==true||proof.provenance?.businessSourceClean!==true||!plan.bindings?.length)throw Error('Mixed or unsuccessful native proof');
 for(const phase of ['write','restore'])if(proof.phases?.[phase]?.result!=='passed'||proof.phases[phase].focus!==null||proof.phases[phase].sha!==plan.sha)throw Error('Incomplete full native phase');
 const entries=new Map(ledger.entries.map(row=>[row.id,row])),seen=new Set();
 return plan.bindings.map(binding=>{
  const rows=proof.records.filter(row=>row.scenario===binding.scenario);
  if(rows.length!==1||rows[0].sha!==plan.sha||rows[0].platform!=='darwin'||rows[0].arch!=='arm64'||!binding.assertion?.trim()||!binding.limitations?.trim()||!binding.callbackAnchors?.length||!binding.entries?.length)throw Error('Missing exact component assertion or participation');
  if(binding.callbackAnchors.some(id=>!id.includes(':'+binding.file+':')||!rows[0].executed.includes(id)))throw Error('Unexecuted direct component participation');
  for(const id of binding.entries){
   const entry=entries.get(id);if(!entry||entry.file!==binding.file||!['source','export'].includes(entry.kind)||entry.uiBehavior||seen.has(id))throw Error('Unknown, duplicate or inferred callback/component binding');seen.add(id);
  }
  return {sha:plan.sha,target:'darwin-arm64',entries:binding.entries,result:'passed',scenario:'Named native component responsibility: '+binding.scenario,assertion:binding.assertion,limitations:binding.limitations+' Same fresh native scenario as the UI receipt; this is an additional reviewed scope association, not another test execution. Signature-command and update installation fixture limitations are preserved.',proof:reference,review:binding};
 });
}
export function main(args){
 const [ledgerFile,previousFile,inputFile,planFile,output,policyFile]=args;if(!policyFile)throw Error('Usage: p0-native-components.mjs LEDGER PREVIOUS CURRENT_NATIVE_RECEIPTS REVIEW_PLAN NEW_OUTPUT POLICY');
 const ledger=JSON.parse(fs.readFileSync(ledgerFile)),previous=JSON.parse(fs.readFileSync(previousFile)),input=JSON.parse(fs.readFileSync(inputFile)),plan=JSON.parse(fs.readFileSync(planFile));validateLedger(ledger);
 const policy=readPolicy(policyFile);if(!policy.localProofs||input.sha!==plan.sha||input.baseline!==ledger.sha||input.policy!==policy.id||!policy.requiredTargets.includes('darwin-arm64'))throw Error('Mixed policy/source');
 const references=new Set(input.runs.map(r=>JSON.stringify(r.proof)));if(references.size!==1)throw Error('Expected one full fresh native proof');
 const original=JSON.parse([...references][0]);if(!validProof(original,inputFile,policy))throw Error('Invalid native execution proof');
 const bytes=fs.readFileSync(path.resolve(path.dirname(inputFile),original.path)),proof=JSON.parse(bytes);
 const combined=JSON.stringify({native:proof,plan,driverSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))},null,2)+'\n';
 const runs=componentRuns(ledger,proof,plan,{path:'component-proof.json',sha256:hash(combined)});
 const receipts={stage:'after-retirement',policy:policy.id,sha:plan.sha,baseline:ledger.sha,runs};
 fs.mkdirSync(output,{recursive:false});fs.writeFileSync(path.join(output,'component-proof.json'),combined);fs.writeFileSync(path.join(output,'receipts.json'),JSON.stringify(receipts,null,2)+'\n');fs.writeFileSync(path.join(output,'missing-progress.json'),JSON.stringify(missingProgress(ledger,previous,receipts),null,2)+'\n');
 console.log(JSON.stringify({bindings:runs.length,ids:new Set(runs.flatMap(r=>r.entries)).size,additionalExecutions:0}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
