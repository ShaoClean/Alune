// Acceptance-build-only Vite transform. Match the P0 callback's source tokens,
// tag and relative path (not its shifted line number). Never invoke a callback
// to manufacture coverage or record user input/arguments.
import { bindings, matchBindings, type AuditIndex } from './ui-audit-bindings.ts';
import { relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import index from './p0-ui-index.json' with { type: 'json' };

const runtime = `
function __aluneAuditBind(key,fn){
  if(typeof fn!=='function' || !window.aluneAgent)return fn;
  const state=window.__aluneAudit??=(()=>{
    let saved;try{saved=JSON.parse(sessionStorage.getItem('alune.audit.cases')||'[]');}catch{}
    const hits=new Set(Array.isArray(saved)?saved:[]);
    const counts=new Map(JSON.parse(sessionStorage.getItem('alune.audit.counts')||'[]'));
    addEventListener('pagehide',()=>{try{sessionStorage.setItem('alune.audit.cases',JSON.stringify([...hits]));sessionStorage.setItem('alune.audit.counts',JSON.stringify([...counts]));}catch{}});
    return {hits,counts,functions:new WeakMap()};
  })();
  let wrappers=state.functions.get(fn);
  if(!wrappers){wrappers=new Map();state.functions.set(fn,wrappers);}
  if(!wrappers.has(key))wrappers.set(key,function(...args){state.hits.add(key);state.counts.set(key,(state.counts.get(key)||0)+1);return Reflect.apply(fn,this,args);});
  return wrappers.get(key);
}`;
export function auditUi(root: string, catalog: AuditIndex = index): Plugin {
  return {
    name: 'p0-ui-execution-audit',
    enforce: 'pre',
    transform(code, id) {
      const file = relative(root, resolve(id.split('?')[0])).replaceAll('\\', '/');
      if (!file.startsWith('apps/web/src/') || !/\.tsx?$/.test(file)) return;
      const edits: { at: number; str: string }[] = [];
      for (const { binding, id } of matchBindings(bindings(file, code), catalog)) {
        for (const expr of [binding.site, ...binding.cleanup]) {
          edits.push(
            { at: expr.getStart(), str: '__aluneAuditBind(' + JSON.stringify(id) + ',' },
            { at: expr.end, str: ')' },
          );
        }
      }
      if (!edits.length) return;
      for (const edit of edits.sort((a, b) => b.at - a.at))
        code = code.slice(0, edit.at) + edit.str + code.slice(edit.at);
      return { code: runtime + '\n' + code, map: null };
    },
  };
}
