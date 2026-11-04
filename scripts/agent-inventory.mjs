// Reproducible source inventory for the Agent migration. This is discovery,
// not a claim that an entry is migrated or covered by a passing test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .sort();
const roots = [
  'apps/server/src/',
  'apps/web/src/',
  'apps/desktop/src/',
  'packages/ssh-client/src/',
  'packages/shared/src/',
];
const tests = tracked.filter((file) =>
  /(?:\.spec\.ts|\.test\.[cm]?js|\.integration\.cjs|smoke\.cjs)$/.test(file),
);
const entries = [];
const sources = [];
const testCases = [];

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
function add(file, source, node, kind, name, extra = {}) {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  entries.push({ id: `${kind}:${file}:${name}`, file, line, kind, name, ...extra });
}
function decorators(node) {
  return (ts.canHaveDecorators(node) ? ts.getDecorators(node) : []) || [];
}
function decorator(node, name) {
  return decorators(node)
    .map((d) => d.expression)
    .find((e) => ts.isCallExpression(e) && e.expression.getText() === name);
}
function literal(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

for (const file of tracked.filter(
  (f) => roots.some((r) => f.startsWith(r)) && /\.(?:tsx?|cjs)$/.test(f) && !tests.includes(f),
)) {
  const source = parse(file);
  sources.push(file);
  add(file, source, source, 'source', file);
  walk(source, (node) => {
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(source))) {
      const element = node.parent.parent;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      add(
        file,
        source,
        node,
        'ui-handler',
        `${element.tagName.getText(source)}.${node.name.getText(source)}:${line}`,
      );
    }
    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (node.name) add(file, source, node, 'export', node.name.getText(source));
      if (ts.isVariableStatement(node))
        for (const declaration of node.declarationList.declarations) {
          add(file, source, declaration, 'export', declaration.name.getText(source));
        }
    }
    if (ts.isClassDeclaration(node)) {
      const controller = decorator(node, 'Controller');
      const prefix = literal(controller?.arguments[0]) || '';
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const name = `${node.name?.text}.${member.name.getText(source)}`;
        add(file, source, member, 'method', name);
        for (const verb of ['Get', 'Post', 'Put', 'Patch', 'Delete']) {
          const route = decorator(member, verb);
          if (route)
            add(
              file,
              source,
              member,
              'http',
              `${verb.toUpperCase()} /${[prefix, literal(route.arguments[0])].filter(Boolean).join('/')}`,
              { handler: name },
            );
        }
        const message = decorator(member, 'SubscribeMessage');
        if (message)
          add(
            file,
            source,
            member,
            'socket-handler',
            literal(message.arguments[0]) ?? message.arguments[0].getText(source),
            { handler: name },
          );
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer) &&
      file.includes('/api/')
    ) {
      for (const member of node.initializer.properties) {
        if (member.name)
          add(
            file,
            source,
            member,
            'client-api',
            `${node.name.text}.${member.name.getText(source)}`,
          );
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression.getText(source);
      if (
        ['emit', 'on', 'once', 'invoke', 'send', 'sendSync', 'handle'].includes(method) &&
        node.arguments[0]
      ) {
        const event = literal(node.arguments[0]);
        // Include nonliteral registrations explicitly: loops cannot silently vanish.
        if (event?.includes(':') || /ipcMain|ipcRenderer/.test(receiver)) {
          add(
            file,
            source,
            node,
            'channel',
            `${receiver}.${method}:${event ?? node.arguments[0].getText(source)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
            { channel: event ?? null, dynamic: !event },
          );
        }
      }
    }
  });
}

for (const file of tests) {
  const source = parse(file);
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression.getText(source);
    if (!/^(?:test|it|describe)(?:\.(?:skip|only|todo))?$/.test(callee)) return;
    const title = literal(node.arguments[0]);
    if (title)
      testCases.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        title,
        declaration: callee,
      });
  });
}
const counts = Object.fromEntries(
  [...new Set(entries.map((e) => e.kind))]
    .sort()
    .map((kind) => [kind, entries.filter((e) => e.kind === kind).length]),
);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: Boolean(
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      ),
      scope: roots,
      limitations: [
        'Static discovery only; no test coverage or migration acceptance inferred.',
        'Dynamic registrations require manual expansion; test titles do not prove assertions.',
        'Source rows include UI-only behavior; manually map controls, ownership and acceptance scenarios.',
      ],
      counts,
      sources,
      entries,
      tests,
      testCases,
    },
    null,
    2,
  ),
);
