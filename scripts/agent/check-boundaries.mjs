import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../..', import.meta.url));
const manifests = new Map();
for (const base of ['packages', 'apps'])
  for (const entry of fs.readdirSync(path.join(root, base), { withFileTypes: true })) {
    const file = path.join(root, base, entry.name, 'package.json');
    if (entry.isDirectory() && fs.existsSync(file)) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      manifests.set(manifest.name, manifest);
    }
  }
const done = new Set();
function visit(name, stack = []) {
  if (done.has(name)) return;
  assert(!stack.includes(name), `Workspace dependency cycle: ${[...stack, name].join(' -> ')}`);
  const manifest = manifests.get(name);
  for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
    if (manifests.has(dependency)) visit(dependency, [...stack, name]);
  done.add(name);
}
for (const name of manifests.keys()) visit(name);
const files = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
  });
const forbidden = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'process',
  'require',
  'eval',
  'Function',
  'Deno',
  'Bun',
  'document',
  'window',
  'localStorage',
]);
for (const pkg of ['domain', 'protocol']) {
  const sourceRoot = path.join(root, 'packages', pkg, 'src');
  for (const file of files(sourceRoot)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function check(node, parent) {
      // A DTO property named "fetch" is data, not an access to the global.
      const propertyName = parent && ts.isPropertyAssignment(parent) && parent.name === node;
      if (ts.isIdentifier(node) && !propertyName)
        assert(!forbidden.has(node.text), `${file}: I/O/runtime global ${node.text}`);
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier?.text;
        if (specifier)
          assert(
            (pkg === 'protocol' && specifier === '@alune/domain') ||
              (specifier.startsWith('.') &&
                path.resolve(path.dirname(file), specifier).startsWith(sourceRoot + path.sep)),
            `${file}: dependency outside pure boundary: ${specifier}`,
          );
      }
      if (ts.isCallExpression(node))
        assert(
          node.expression.kind !== ts.SyntaxKind.ImportKeyword,
          `${file}: dynamic import outside contract`,
        );
      ts.forEachChild(node, (child) => check(child, node));
    }
    check(source);
  }
}
console.log(
  `Workspace dependency graph is acyclic (${done.size} packages); domain/protocol have no I/O imports or globals.`,
);

// Business code is transport-neutral and cannot depend on retired runtimes.
for (const directory of [
  'modules/git',
  'modules/repositories',
  'modules/ai',
  'modules/reviews',
  'modules/workspace',
  'adapters/providers',
]) {
  for (const file of files(path.join(root, 'packages/agent/src', directory))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier?.text;
      if (!specifier) continue;
      assert(
        !/^(?:@alune\/(?:shared|ssh-client)|@nestjs\/|electron$|ssh2$|(?:node:)?(?:fs(?:\/promises)?|child_process)$)/.test(
          specifier,
        ),
        `${file}: legacy runtime or native I/O crossed the repository port: ${specifier}`,
      );
    }
  }
}
console.log('Repository read modules use domain models and Agent ports only.');
