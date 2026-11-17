import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentRuns } from './p0-native-components.mjs';
function fixture(){
 const sha='a'.repeat(40),baseline='b'.repeat(40),file='apps/web/src/Component.tsx';
 const id='export:'+file+':Component',anchor='ui-handler:'+file+':Button.onClick:1';
 return {ledger:{sha:baseline,entries:[{id,file,kind:'export'}]},proof:{sha,baseline,provenance:{exitCode:0,inputsStable:true,businessSourceClean:true},phases:Object.fromEntries(['write','restore'].map(p=>[p,{result:'passed',focus:null,sha}])),records:[{sha,platform:'darwin',arch:'arm64',scenario:'exact visible result and Git bytes',executed:[anchor]}]},plan:{sha,baseline,bindings:[{file,entries:[id],scenario:'exact visible result and Git bytes',assertion:'Visible result and independent Git bytes match the explicit fixture.',limitations:'Only this behavior',callbackAnchors:[anchor]}]}};
}
test('component review associates only named source/export responsibility and does not count callback anchors',()=>{
 const {ledger,proof,plan}=fixture();const runs=componentRuns(ledger,proof,plan,{});assert.deepEqual(runs[0].entries,plan.bindings[0].entries);assert.equal(runs[0].entries.length,1);assert.match(runs[0].limitations,/not another test execution/);
});
test('incomplete native phase or missing direct component participation cannot be promoted',()=>{
 for(const mutate of [p=>{p.phases.restore.result='failed';},p=>{p.records[0].executed=[];},p=>{p.provenance.inputsStable=false;}]){const {ledger,proof,plan}=fixture();mutate(proof);assert.throws(()=>componentRuns(ledger,proof,plan,{}));}
});
test('duplicate, wrong-file, unknown and callback entries cannot be inferred as component exports',()=>{
 for(const change of [b=>{b.entries.push(b.entries[0]);},b=>{b.file='other.tsx';},b=>{b.entries=['unknown'];}]){const {ledger,proof,plan}=fixture();change(plan.bindings[0]);assert.throws(()=>componentRuns(ledger,proof,plan,{}));}
});
