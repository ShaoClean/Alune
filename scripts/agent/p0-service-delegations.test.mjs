import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transparentDelegate, delegationRuns } from './p0-service-delegations.mjs';
const source='export class Controller { constructor(private service: Service) {} run() { return this.service.read("fixture"); } }';
const endpoint={id:'http:one',kind:'http',name:'GET /one',file:'controller.ts',handler:'Controller.run',line:1};
const method={id:'method:service:Service.read',kind:'method',name:'Service.read',file:'service.ts'};
const ledger={sha:'a'.repeat(40),entries:[endpoint,{id:'method:controller:Controller.run',kind:'method',name:'Controller.run',file:'controller.ts'},method]};
const report={baseline:ledger.sha,candidate:'b'.repeat(40),target:'darwin-arm64',rows:[{scenario:'exact output',route:'GET /one',result:'equal',observedFrozenMethods:[method.id,'unreviewed incidental helper']}]};
const spec={expectedCases:1,assertion:'Exact output equals baseline',limitations:'isolated fixture'};
const plan=[{route:endpoint.name,controller:endpoint.file,methodId:method.id,...Object.fromEntries(Object.entries(transparentDelegate(source,endpoint.handler)).filter(([key])=>key!=='method')),scenarios:['exact output']}];
const run=(r=report,s=source,p=plan)=>delegationRuns(ledger,r,spec,report.candidate,report.target,p,()=>s,{});

test('direct returned service output earns only the exact reviewed method, never incidental helpers or a module',()=>{
 const runs=run();assert.deepEqual(runs.map(r=>r.entries),[[method.id]]);assert.match(runs[0].limitations,/no claim of a fresh replay/);
});
test('additional controller effects, conditional calls, dynamic owners and argument drift invalidate direct return review',()=>{
 for(const changed of [source.replace('return this.service.read','const x=1; return this.service.read'),source.replace('return this.service.read("fixture")','return true ? this.service.read("fixture") : null'),source.replace('this.service.read','factory().read')])assert.throws(()=>run(report,changed));
 assert.throws(()=>run(report,source.replace('"fixture"','"different"')),/drift/);
});
test('paired execution, exact scenario, full batch and baseline identity are all required',()=>{
 assert.throws(()=>run({...report,rows:[{...report.rows[0],observedFrozenMethods:[]}]}),/execution/);
 assert.throws(()=>run({...report,rows:[{...report.rows[0],result:'not-equal'}]}),/nonpassing/);
 assert.throws(()=>run({...report,rows:[]}),/Incomplete/);
 assert.throws(()=>run({...report,candidate:'c'.repeat(40)}),/Incomplete/);
 assert.deepEqual(run(report,source,[{...plan[0],scenarios:['not executed']}]),[]);
});
test('a failed unselected scenario cannot be hidden by a passed reviewed one',()=>{
 const rows=[report.rows[0],{...report.rows[0],scenario:'other failure',result:'not-equal'}];
 assert.throws(()=>delegationRuns(ledger,{...report,rows},{...spec,expectedCases:2},report.candidate,report.target,plan,()=>source,{}),/nonpassing/);
});
