// Re-review already executed namespace and error-helper contracts. No new replay.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, baseline } from './p0-client-cases.mjs';
import { certify, supplemental, contractFile, regressionFile, hash } from './p0-client-runner.mjs';
import { regressionNames } from './p0-client-regressions.mjs';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { readPolicy, validProof } from './acceptance-policy.mjs';
export const namespaces=[
 ['ai.ts','aiApi'],['logging.ts','loggingApi'],['proxy.ts','proxyApi'],
 ...['accessTokenApi','connectionApi','repositoryApi','gitApi','fileApi','pullRequestCenterApi'].map(name=>['index.ts',name]),
];
export function exportRuns(ledger,events,target,proof){
 const expected=[...cases.map(c=>({file:contractFile,name:c.testName})),...supplemental.map(name=>({file:contractFile,name})),...regressionNames.map(name=>({file:regressionFile,name}))];
 certify(events,expected);
 const known=new Set(ledger.entries.map(e=>e.id));
 const limit='Original same-SHA client execution reused after explicit namespace review; no new feature replay. Actual facades/adapters/source SDK execute at a mocked request and host boundary. No server, actual SSH, UI, persistence, installer or complete branch acceptance.';
 const runs=namespaces.map(([module,name])=>{
  const file='apps/web/src/api/'+module;
  const selected=cases.filter(c=>c.entryId.startsWith(`client-api:${file}:${name}.`));
  if(!selected.length)throw Error('Namespace has no exact public invocation assertions');
  return {sha:baseline.head,target,entries:[`export:${file}:${name}`],result:'passed',proof,
   scenario:'Public namespace return/error contract: '+name,
   assertion:'Every listed case actually invokes this exported namespace: exact ordered host/RPC/params/options, return projection, uninstalled rejection and error identity. Cases: '+selected.map(c=>c.testName).join('; '),limitations:limit};
 });
 for(const [module,name]of [['ai.ts','aiError'],['logging.ts','loggingError'],['proxy.ts','proxyError']])runs.push({sha:baseline.head,target,entries:[`export:apps/web/src/api/${module}:${name}`],result:'passed',proof,scenario:'Direct client error projection: '+name,assertion:'The supplemental exact helper test rejects arbitrary secret/transport messages and returns explicit safe defaults; protocol errors preserve their exact public message in the actual namespace cases.',limitations:limit});
 // Source responsibility is deliberately scoped to the named facade methods,
 // not construction, every export, or a completeness assertion.
 for(const module of ['ai.ts','index.ts','logging.ts','proxy.ts'])runs.push({sha:baseline.head,target,entries:[`source:apps/web/src/api/${module}:apps/web/src/api/${module}`],result:'passed',proof,scenario:'Scoped facade source responsibility: '+module,assertion:'The exact named facade namespace methods from this source execute and preserve their explicitly asserted public input, output and error projections. Source association is limited to these methods; logging bridge/window helpers and retired timeout configuration are not inferred.',limitations:limit});
 for(const run of runs)if(run.entries.some(id=>!known.has(id)))throw Error('Unknown reviewed namespace ID');
 return runs;
}
export function main(args){
 const [ledgerFile,previousFile,inputFile,output,policyFile]=args;if(!policyFile)throw Error('Usage: p0-client-export-receipts.mjs LEDGER PREVIOUS ORIGINAL_CLIENT_RECEIPTS NEW_OUTPUT POLICY');
 const ledger=JSON.parse(fs.readFileSync(ledgerFile)),previous=JSON.parse(fs.readFileSync(previousFile)),input=JSON.parse(fs.readFileSync(inputFile));validateLedger(ledger);
 const policy=readPolicy(policyFile),target=process.platform+'-'+process.arch;
 if(!policy.localProofs||!policy.requiredTargets.includes(target)||input.sha!==baseline.head||input.policy!==policy.id||input.baseline!==ledger.sha)throw Error('Mixed source/policy');
 const proofs=new Set(input.runs.map(r=>JSON.stringify(r.proof)));if(proofs.size!==1)throw Error('Expected exactly one original complete client proof');
 const reference=JSON.parse([...proofs][0]);if(!validProof(reference,inputFile,policy))throw Error('Invalid original client proof');
 const proofPath=path.resolve(path.dirname(inputFile),reference.path),bytes=fs.readFileSync(proofPath),proof=JSON.parse(bytes);
 if(!validProof(proof.events,proofPath,policy)||proof.sourceState?.head!==baseline.head)throw Error('Missing complete original source and event proof');
 const eventsPath=path.resolve(path.dirname(proofPath),proof.events.path),eventBytes=fs.readFileSync(eventsPath);
 const runs=exportRuns(ledger,JSON.parse(eventBytes),target,{path:'proof.json',sha256:hash(bytes)});
 fs.mkdirSync(output,{recursive:false});fs.writeFileSync(path.join(output,'proof.json'),bytes);fs.writeFileSync(path.join(output,proof.events.path),eventBytes);
 const receipts={stage:'after-retirement',sha:baseline.head,baseline:ledger.sha,policy:policy.id,runs};
 fs.writeFileSync(path.join(output,'receipts.json'),JSON.stringify(receipts,null,2)+'\n');fs.writeFileSync(path.join(output,'missing-progress.json'),JSON.stringify(missingProgress(ledger,previous,receipts),null,2)+'\n');
 console.log(JSON.stringify({namespaces:namespaces.length,ids:runs.length,replayed:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
