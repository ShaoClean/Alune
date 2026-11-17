// Reviewed one-hop return contracts only. A trace hit by itself earns nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { pairedRuns } from './p0-paired-receipts.mjs';
import { readPolicy } from './acceptance-policy.mjs';
const root=fileURLToPath(new URL("../../../",import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function transparentDelegate(source,handler){
 const sf=ts.createSourceFile('controller.ts',source,ts.ScriptTarget.Latest,true);
 const [className,method]=handler.split('.');
 const cls=sf.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===className);
 const ctor=cls?.members.find(ts.isConstructorDeclaration);
 const methodNode=cls?.members.find(n=>ts.isMethodDeclaration(n)&&n.name?.getText(sf)===method);
 if(methodNode?.body?.statements.length!==1||!ts.isReturnStatement(methodNode.body.statements[0]))throw Error('Controller must only return its delegated call');
 let call=methodNode.body.statements[0].expression;
 if(call&&ts.isAwaitExpression(call))call=call.expression;
 if(!call||!ts.isCallExpression(call)||!ts.isPropertyAccessExpression(call.expression))throw Error('Expected one direct returned call');
 const owner=call.expression.expression;
 if(!ts.isPropertyAccessExpression(owner)||owner.expression.kind!==ts.SyntaxKind.ThisKeyword)throw Error('Expected constructor-injected owner');
 const parameter=ctor?.parameters.find(p=>p.name.getText(sf)===owner.name.text);
 if(!parameter?.type||!ts.isTypeReferenceNode(parameter.type))throw Error('Owner has no exact injected type');
 return {method:parameter.type.getText(sf)+'.'+call.expression.name.text,call:call.getText(sf),line:sf.getLineAndCharacterOfPosition(call.getStart(sf)).line+1};
}
export function delegationRuns(ledger,report,spec,sha,target,plan,loadFrozen,proof){
 // Reuse the complete-report verifier: no green-row salvage from an invalid batch.
 const checked=pairedRuns(ledger,report,spec,sha,target,proof);
 if(checked.some(run=>run.result!=='passed'))throw Error('Paired batch contains a nonpassing scenario');
 const rows=report.rows??report.results,runs=[];
 for(const binding of plan){
  const endpoints=ledger.entries.filter(e=>e.kind==='http'&&e.name===binding.route);
  const method=ledger.entries.find(e=>e.id===binding.methodId);
  if(endpoints.length!==1||method?.kind!=='method')throw Error('Unknown reviewed route or service method');
  const endpoint=endpoints[0],source=loadFrozen(endpoint.file);
  const direct=transparentDelegate(source,endpoint.handler);
  if(direct.method!==method.name||direct.call!==binding.call||direct.line!==binding.line||endpoint.file!==binding.controller)throw Error('Reviewed direct-return contract drift');
  const matches=rows.filter(row=>row.route===binding.route&&binding.scenarios.includes(row.scenario));
  if(!matches.length)continue; // Other independently validated report owns this route.
  for(const row of matches){
   if(row.result!=='equal'||!row.observedFrozenMethods?.includes(method.id))throw Error('Missing actual paired delegate execution');
   runs.push({sha,target,entries:[method.id],result:'passed',proof,
    scenario:'Direct returned service contract: '+row.scenario,
    assertion:`Frozen ${endpoint.handler} has exactly one statement, returning ${binding.call}; its exact returned value or declared Git/filesystem effects are asserted by the paired scenario. ${spec.assertion}`,
    limitations:spec.limitations+' Same-SHA original execution proof reused after exact one-hop return review; no claim of a fresh replay. No other traced internal helper, class, constructor, source module or service branch is credited.',
    delegation:{...binding,sourceSha256:hash(source),pairedScenario:row.scenario}});
  }
 }
 return runs;
}
export function main(args){
 const [ledgerFile,previousFile,manifestFile,planFile,output,policyFile]=args;
 if(!policyFile)throw Error('Usage: p0-service-delegations.mjs LEDGER PREVIOUS PAIRED_MANIFEST REVIEW_PLAN NEW_OUTPUT POLICY');
 const ledger=JSON.parse(fs.readFileSync(ledgerFile));validateLedger(ledger);
 const previous=JSON.parse(fs.readFileSync(previousFile)),manifest=JSON.parse(fs.readFileSync(manifestFile)),plan=JSON.parse(fs.readFileSync(planFile));
 const target=process.platform+'-'+process.arch,policy=readPolicy(policyFile);
 if(!policy.localProofs||!policy.requiredTargets.includes(target)||plan.sha!==manifest.sha||plan.baseline!==ledger.sha||!plan.bindings?.length)throw Error('Mixed policy or reviewed plan');
 const keys=plan.bindings.map(b=>b.route);if(new Set(keys).size!==keys.length)throw Error('Duplicate reviewed route');
 for(const binding of plan.bindings)if(!binding.scenarios?.length||new Set(binding.scenarios).size!==binding.scenarios.length)throw Error('Missing exact scenario selectors');
 const labels=manifest.reports.map(s=>s.label);
 if(new Set(labels).size!==labels.length||labels.some(s=>!/^[a-z0-9-]+$/.test(s)))throw Error('Invalid or duplicate paired report label');
 fs.mkdirSync(output,{recursive:false});const runs=[];
 const sources=new Map();const loadFrozen=file=>{if(!sources.has(file))sources.set(file,execFileSync('git',['show',ledger.sha+':'+file],{cwd:root,encoding:'utf8'}));return sources.get(file);};
 for(const spec of manifest.reports){
  const source=path.resolve(path.dirname(manifestFile),spec.file),bytes=fs.readFileSync(source),report=JSON.parse(bytes);
  const name=spec.label+'-proof.json';
  const relevant=plan.bindings.filter(b=>(report.rows??report.results).some(r=>r.route===b.route&&b.scenarios.includes(r.scenario)));
  const proofBytes=JSON.stringify({sha:manifest.sha,baseline:ledger.sha,target,execution:'Reused original same-SHA paired report; no new feature replay',reportSha256:hash(bytes),report,reviewedDelegations:relevant,driverSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))},null,2)+'\n';
  const proof={path:name,sha256:hash(proofBytes)};
  const actual=delegationRuns(ledger,report,spec,manifest.sha,target,relevant,loadFrozen,proof);
  fs.writeFileSync(path.join(output,name),proofBytes);runs.push(...actual);
 }
 const seenRoutes=new Set(runs.map(r=>r.delegation.route));
 if(seenRoutes.size!==plan.bindings.length)throw Error('Unexecuted reviewed direct-return contract');
 const receipts={stage:'after-retirement',policy:policy.id,sha:manifest.sha,baseline:ledger.sha,runs};
 fs.writeFileSync(path.join(output,'receipts.json'),JSON.stringify(receipts,null,2)+'\n');
 fs.writeFileSync(path.join(output,'missing-progress.json'),JSON.stringify(missingProgress(ledger,previous,receipts),null,2)+'\n');
 console.log(JSON.stringify({routes:seenRoutes.size,scenarios:runs.length,uniqueMethods:new Set(runs.flatMap(r=>r.entries)).size,replayed:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
