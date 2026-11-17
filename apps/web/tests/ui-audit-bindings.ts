// Acceptance tooling only. A callback is identified by the frozen file,
// member and tokens. Context is used only when it selects a single site.
import ts from 'typescript';
import { createHash } from 'node:crypto';
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
export function tokens(code: string): string[] {
  const s = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, code),
    out: string[] = [];
  while (s.scan() !== ts.SyntaxKind.EndOfFileToken) out.push(s.getTokenText());
  return out;
}
export const auditKey = (file: string, kind: string, member: string, code: string) =>
  digest([file, kind, member, tokens(code)]);
export type Binding = {
  key: string;
  id: string;
  kind: string;
  site: ts.Expression;
  cleanup: ts.Expression[];
  context: string;
  exact: string;
  eligible: boolean;
};
export type AuditIndex = {
  callbacks: Record<string, string[]>;
  anchors?: Record<string, string[]>;
  successors?: Record<string, string[]>;
};
export function bindings(file: string, code: string): Binding[] {
  const sf = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const span: { start: number; end: number; text: string }[] = [];
  function flatten(n: ts.Node) {
    const children = n.getChildren(sf);
    if (children.length) children.forEach(flatten);
    else if (n.getWidth(sf) > 0)
      span.push({ start: n.getStart(sf), end: n.end, text: n.getText(sf) });
  }
  flatten(sf);
  function lower(pos: number) {
    let l = 0,
      r = span.length;
    while (l < r) {
      const k = (l + r) >>> 1;
      if (span[k].start < pos) l = k + 1;
      else r = k;
    }
    return l;
  }
  const topHashes = new Map<ts.Node, string>(),
    out: Binding[] = [];
  type Pair = { scope: ts.Node; tuple: string; expr: ts.Expression; binding?: Binding };
  const adds: Pair[] = [],
    removes: Pair[] = [];
  const owner = (n: ts.Node): ts.Node =>
    ts.isSourceFile(n) || ts.isFunctionLike(n) ? n : owner(n.parent);
  function site(kind: string, member: string, n: ts.Node, expr: ts.Expression, original: string) {
    let top = n;
    while (top.parent !== sf) top = top.parent;
    const a = lower(expr.getStart(sf)),
      b = lower(expr.end),
      first = lower(top.getStart(sf));
    const key = auditKey(file, kind, member, original);
    if (!topHashes.has(top))
      topHashes.set(top, digest(span.slice(first, lower(top.end)).map((t) => t.text)));
    const binding: Binding = {
      key,
      kind,
      id:
        kind +
        ':' +
        file +
        ':' +
        member +
        ':' +
        (sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1),
      context: digest([
        key,
        span.slice(Math.max(first, a - 20), a).map((t) => t.text),
        span.slice(b, Math.min(lower(top.end), b + 20)).map((t) => t.text),
      ]),
      exact: digest([key, topHashes.get(top), a - first]),
      site: expr,
      cleanup: [],
      eligible: true,
    };
    out.push(binding);
    return binding;
  }
  function walk(n: ts.Node) {
    if (
      ts.isJsxAttribute(n) &&
      /^on[A-Z]/.test(n.name.getText(sf)) &&
      n.initializer &&
      ts.isJsxExpression(n.initializer) &&
      n.initializer.expression
    ) {
      const el = n.parent.parent;
      if (ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el))
        site(
          'ui-handler',
          el.tagName.getText(sf) + '.' + n.name.getText(sf),
          n,
          n.initializer.expression,
          n.initializer.getText(sf),
        );
    } else if (ts.isPropertyAssignment(n) && /^on[A-Z]/.test(n.name.getText(sf))) {
      site('ui-object-handler', n.name.getText(sf), n, n.initializer, n.initializer.getText(sf));
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text,
        dom = method === 'addEventListener' || method === 'removeEventListener',
        expr = n.arguments[dom ? 1 : 0];
      if (expr && (dom || ['onData', 'onResize', 'attachCustomKeyEventHandler'].includes(method))) {
        const binding =
          method === 'removeEventListener'
            ? undefined
            : site(
                'ui-listener',
                n.expression.expression.getText(sf) + '.' + method,
                n,
                expr,
                expr.getText(sf),
              );
        if (dom && binding)
          binding.eligible = ts.isArrowFunction(expr) || ts.isFunctionExpression(expr);
        const recv = n.expression.expression,
          type = n.arguments[0];
        if (dom && ts.isIdentifier(expr) && ts.isIdentifier(recv) && ts.isStringLiteral(type)) {
          const tuple = JSON.stringify([recv.text, type.text, expr.text]);
          let scope = owner(n);
          if (method === 'removeEventListener') {
            // Only pair a closed-over reference in a direct returned cleanup.
            // Never replace a named callback when its removal cannot be proven.
            if (
              !ts.isArrowFunction(scope) ||
              scope.parameters.length ||
              !ts.isReturnStatement(scope.parent)
            )
              return;
            scope = owner(scope.parent);
            removes.push({ scope, tuple, expr });
          } else adds.push({ scope, tuple, expr, binding });
        }
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(sf);
  for (const add of adds) {
    const same = (p: Pair) => p.scope === add.scope && p.tuple === add.tuple;
    const clean = removes.filter(same);
    // Every use of this local callback must be a declaration, a direct call
    // (left unchanged), or a proven add/cleanup pair. In particular, an
    // escaped handler might be removed through an alias, so leave it intact.
    const allowed = new Set<ts.Node>();
    for (const another of adds.filter(
      (p) => p.scope === add.scope && p.expr.getText(sf) === add.expr.getText(sf),
    )) {
      const pair = (p: Pair) => p.scope === another.scope && p.tuple === another.tuple;
      const end = removes.filter(pair);
      if (adds.filter(pair).length === 1 && end.length === 1) {
        allowed.add(another.expr);
        allowed.add(end[0].expr);
      }
    }
    let declarations = 0,
      escaped = false;
    function checkUses(n: ts.Node) {
      if (ts.isIdentifier(n) && n.text === add.expr.getText(sf) && !allowed.has(n)) {
        const decl = n.parent;
        if (
          ((ts.isVariableDeclaration(decl) &&
            decl.initializer &&
            (ts.isFunctionExpression(decl.initializer) || ts.isArrowFunction(decl.initializer))) ||
            ts.isFunctionDeclaration(decl)) &&
          decl.name === n
        )
          declarations++;
        else if (!ts.isCallExpression(decl) || decl.expression !== n) escaped = true;
      }
      ts.forEachChild(n, checkUses);
    }
    checkUses(add.scope);
    if (escaped || declarations !== 1) continue;
    if (adds.filter(same).length === 1 && clean.length === 1 && add.binding) {
      add.binding.eligible = true;
      add.binding.cleanup = [clean[0].expr];
    }
  }
  return out;
}
export function matchBindings(sites: Binding[], index: AuditIndex) {
  const counts = new Map<string, number>();
  for (const s of sites)
    for (const k of [s.key, s.context, s.exact]) counts.set(k, (counts.get(k) ?? 0) + 1);
  const candidates = sites.flatMap((s) => {
    if (!s.eligible) return [];
    const matches = new Set<string>();
    for (const [key, ids] of [
      [s.key, index.callbacks[s.key] ?? index.successors?.[s.key]],
      [s.context, index.anchors?.[s.context]],
      [s.exact, index.anchors?.[s.exact]],
    ] as const)
      if (ids?.length === 1 && counts.get(key) === 1) matches.add(ids[0]);
    return matches.size === 1 ? [{ binding: s, id: [...matches][0] }] : [];
  });
  const claims = new Map<string, number>();
  for (const c of candidates) claims.set(c.id, (claims.get(c.id) ?? 0) + 1);
  return candidates.filter((c) => claims.get(c.id) === 1);
}
