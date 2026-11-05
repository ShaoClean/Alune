import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { bindings, matchBindings } from './ui-audit-bindings.ts';
import { auditUi } from './ui-audit.ts';
const file = 'apps/web/src/probe.tsx';
function makeIndex(original) {
  const callbacks = {},
    anchors = {};
  for (const b of bindings(file, original)) {
    (callbacks[b.key] ??= []).push(b.id);
    for (const k of [b.context, b.exact]) (anchors[k] ??= []).push(b.id);
  }
  return { callbacks, anchors };
}
test('unchanged duplicate callbacks keep the correct original identities, but an extra indistinguishable copy earns none', () => {
  const a = 'function First(){return <button name="first" onClick={()=>open()}/>}',
    b = 'function Last(){return <button name="last" onClick={()=>open()}/>}';
  const index = makeIndex(a + '\n' + b);
  const old = bindings(file, a + '\n' + b);
  const matched = matchBindings(bindings(file, b + '\n// inserted lines\n\n' + a), index);
  assert.deepEqual(
    matched.map((m) => m.id),
    [old[1].id, old[0].id],
  );
  const doubled = matchBindings(bindings(file, b + '\n' + a + '\n' + a), index);
  assert.deepEqual(
    doubled.map((m) => m.id),
    [old[1].id],
  );
});
test('DOM registration does not count as execution, preserves this and removal, and leaves escaped handlers alone', () => {
  const code = `function subscribe(){
    const listen=function(){seen.push(this)};
    window.addEventListener('test',listen);
    return ()=>window.removeEventListener('test',listen);
  }
  function escaped(){
    const other=()=>{};
    sendElsewhere(other);
    window.addEventListener('shared',other);
    return ()=>window.removeEventListener('shared',other);
  }`;
  const index = makeIndex(code),
    sites = bindings(file, code);
  assert.equal(sites[1].eligible, false);
  const compiled = auditUi(process.cwd(), index).transform(code, join(process.cwd(), file)).code;
  const window = new EventTarget(),
    seen = [];
  window.aluneAgent = {};
  const end = runInNewContext(compiled + '\nsubscribe()', {
    window,
    seen,
    sessionStorage: {
      getItem() {
        return null;
      },
    },
    addEventListener: () => {},
  });
  assert.equal(window.__aluneAudit.counts.size, 0);
  window.dispatchEvent(new Event('test'));
  assert.deepEqual(seen, [window]);
  assert.equal(window.__aluneAudit.counts.get(sites[0].id), 1);
  end();
  window.dispatchEvent(new Event('test'));
  assert.equal(seen.length, 1);
  assert.equal(window.__aluneAudit.counts.get(sites[0].id), 1);
});

test('one callback shared by two listeners credits only the dispatched registration, never a direct call', () => {
  const code = `function subscribe(a,b){
    const update=()=>seen.push('apply');
    update();
    a.addEventListener('change',update);
    b.addEventListener('change',update);
    return ()=>{a.removeEventListener('change',update);b.removeEventListener('change',update)};
  }`;
  const index = makeIndex(code),
    sites = bindings(file, code);
  const compiled = auditUi(process.cwd(), index).transform(code, join(process.cwd(), file)).code;
  const window = { aluneAgent: {} },
    a = new EventTarget(),
    b = new EventTarget(),
    seen = [];
  const end = runInNewContext(compiled + '\nsubscribe(a,b)', {
    window,
    a,
    b,
    seen,
    sessionStorage: {
      getItem() {
        return null;
      },
    },
    addEventListener: () => {},
  });
  assert.deepEqual(seen, ['apply']);
  assert.equal(window.__aluneAudit.counts.size, 0);
  b.dispatchEvent(new Event('change'));
  assert.equal(window.__aluneAudit.counts.size, 1);
  assert.equal(window.__aluneAudit.counts.get(sites[1].id), 1);
  a.dispatchEvent(new Event('change'));
  assert.equal(window.__aluneAudit.counts.get(sites[0].id), 1);
  end();
  a.dispatchEvent(new Event('change'));
  b.dispatchEvent(new Event('change'));
  assert.equal(seen.length, 3);
});
