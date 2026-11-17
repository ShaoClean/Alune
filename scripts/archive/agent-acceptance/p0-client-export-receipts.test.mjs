import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { exportRuns, namespaces } from './p0-client-export-receipts.mjs';
import { root, contractFile, regressionFile, supplemental } from './p0-client-runner.mjs';
import { cases } from './p0-client-cases.mjs';
import { regressionNames } from './p0-client-regressions.mjs';
function fixture(){
 const tests=[...cases.map(c=>[contractFile,c.testName]),...supplemental.map(name=>[contractFile,name]),...regressionNames.map(name=>[regressionFile,name])];
 const events=tests.map(([file,name])=>({type:'test:pass',data:{file:path.join(root,file),line:1,name,details:{type:'test'}}}));
 events.push({type:'test:summary',data:{success:true,counts:{tests:tests.length,passed:tests.length,failed:0,cancelled:0,skipped:0,todo:0}}});
 const ids=[...namespaces.map(([file,name])=>`export:apps/web/src/api/${file}:${name}`),...['ai.ts:aiError','logging.ts:loggingError','proxy.ts:proxyError'].map(s=>'export:apps/web/src/api/'+s),...['ai.ts','index.ts','logging.ts','proxy.ts'].map(file=>`source:apps/web/src/api/${file}:apps/web/src/api/${file}`)];
 return {ledger:{entries:ids.map(id=>({id}))},events};
}
test('client namespace review requires every case and credits exactly nine namespaces, three error helpers and four scoped sources',()=>{
 const {ledger,events}=fixture();const runs=exportRuns(ledger,events,'darwin-arm64',{});assert.equal(runs.length,16);assert.equal(new Set(runs.flatMap(r=>r.entries)).size,16);assert.ok(runs.every(r=>!r.entries.some(id=>id.includes('gitTimeout')||id.includes('openLogViewer'))));
});
test('missing or skipped exact namespace calls cannot be inferred from a successful batch',()=>{
 for(const change of [events=>events.shift(),events=>{events[0].data.skip=true;}]){const {ledger,events}=fixture();change(events);assert.throws(()=>exportRuns(ledger,events,'darwin-arm64',{}));}
});
test('failed unrelated client assertions invalidate the entire namespace batch',()=>{
 const {ledger,events}=fixture();events.push({type:'test:fail',data:{name:'unrelated regression'}});assert.throws(()=>exportRuns(ledger,events,'darwin-arm64',{}));
});
