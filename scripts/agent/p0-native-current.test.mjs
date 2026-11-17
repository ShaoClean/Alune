import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectNativeRuns, reviewedNative } from './p0-native-current.mjs';
import { pointerScenario } from './p0-history-pointer-review.mjs';
function fixture(){
 const entries=[{id:'old-ui',uiBehavior:'UI-OLD'},...reviewedNative.flatMap(r=>r.entries).map(id=>({id,uiBehavior:'original behavior'})),{id:'incidental-completion',uiBehavior:'unasserted'}];
 const record={sha:'a'.repeat(40),platform:'darwin',arch:'arm64',scenario:'original verified behavior',ui:['UI-OLD'],executed:['old-ui','incidental-completion']};
 return {ledger:{entries},previous:{runs:[{result:'passed',entries:['old-ui']}]},observation:{sha:record.sha,complete:true,records:[record,...reviewedNative.map(r=>({...record,scenario:r.scenario,executed:r.entries,ui:[],facts:r.scenario===pointerScenario?{input:'native Electron pointer',commit:'b'.repeat(40),before:{graph:180,detail:560},after:{graph:240,detail:500}}:undefined}))]}};
}
test('fresh native proof reasserts original IDs and only the six explicitly reviewed missing callbacks',()=>{
 const {ledger,previous,observation}=fixture();const runs=selectNativeRuns(ledger,previous,observation,{});
 assert.deepEqual(new Set(runs.flatMap(r=>r.entries)),new Set(['old-ui',...reviewedNative.flatMap(r=>r.entries)]));
 assert.ok(runs.every(r=>!r.entries.includes('incidental-completion')));
});
test('failed/incomplete or mixed-source native flows cannot mint successful receipts',()=>{
 const {ledger,previous,observation}=fixture();assert.throws(()=>selectNativeRuns(ledger,previous,{...observation,complete:false},{}),/both pass/);
 observation.records[0].sha='c'.repeat(40);assert.throws(()=>selectNativeRuns(ledger,previous,observation,{}),/mixed/);
});
test('missing callback, duplicate scenario or false geometry invalidates individual native assertions',()=>{
 for(const mutate of [o=>{o.records[1].executed=[];},o=>{o.records.push(o.records[1]);},o=>{o.records[1].facts.after.graph=180;}]){
  const {ledger,previous,observation}=fixture();mutate(observation);assert.throws(()=>selectNativeRuns(ledger,previous,observation,{}));
 }
});
