// Acceptance-build-only Vite transform. Match the P0 callback's source tokens,
// tag and relative path (not its shifted line number). Never invoke a callback
// to manufacture coverage or record user input/arguments.
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import index from './p0-ui-index.json';

export function auditKey(file: string, kind: string, member: string, callback: string) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    callback,
  );
  const tokens = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
  return createHash('sha256')
    .update(JSON.stringify([file, kind, member, tokens]))
    .digest('hex')
    .slice(0, 24);
}

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
export function auditUi(root: string): Plugin {
  const catalog = index.callbacks as Record<string, string[]>;
  return {
    name: 'p0-ui-execution-audit',
    enforce: 'pre',
    transform(code, id) {
      const file = relative(root, resolve(id.split('?')[0])).replaceAll('\\', '/');
      if (!file.startsWith('apps/web/src/') || !/\.tsx?$/.test(file)) return;
      const sf = ts.createSourceFile(
        file,
        code,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const edits: { at: number; str: string }[] = [],
        matches = new Map<string, ts.Expression[]>();
      function wrap(kind: string, member: string, expression: ts.Expression, original: string) {
        const key = auditKey(file, kind, member, original);
        if (catalog[key]?.length !== 1) return;
        const group = matches.get(key) ?? [];
        group.push(expression);
        matches.set(key, group);
      }
      function visit(node: ts.Node) {
        if (
          ts.isJsxAttribute(node) &&
          /^on[A-Z]/.test(node.name.getText(sf)) &&
          node.initializer &&
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          const el = node.parent.parent;
          if (ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el))
            wrap(
              'ui-handler',
              el.tagName.getText(sf) + '.' + node.name.getText(sf),
              node.initializer.expression,
              node.initializer.getText(sf),
            );
        } else if (ts.isPropertyAssignment(node) && /^on[A-Z]/.test(node.name.getText(sf))) {
          wrap(
            'ui-object-handler',
            node.name.getText(sf),
            node.initializer,
            node.initializer.getText(sf),
          );
        } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text,
            expr = node.arguments[method === 'addEventListener' ? 1 : 0];
          // Do not change the identity of a DOM listener also used in removeEventListener.
          if (expr && ['onData', 'onResize', 'attachCustomKeyEventHandler'].includes(method))
            wrap('ui-listener', node.expression.getText(sf), expr, expr.getText(sf));
        }
        ts.forEachChild(node, visit);
      }
      visit(sf);
      for (const [key, expressions] of matches) {
        if (expressions.length !== 1) continue;
        const expression = expressions[0];
        edits.push(
          {
            at: expression.getStart(sf),
            str: '__aluneAuditBind(' + JSON.stringify(catalog[key][0]) + ',',
          },
          { at: expression.end, str: ')' },
        );
      }
      if (!edits.length) return;
      for (const edit of edits.sort((a, b) => b.at - a.at))
        code = code.slice(0, edit.at) + edit.str + code.slice(edit.at);
      return { code: runtime + '\n' + code, map: null };
    },
  };
}
