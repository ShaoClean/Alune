import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../..', import.meta.url));
const archive = 'scripts/archive/agent-acceptance';
const manifest = JSON.parse(fs.readFileSync(path.join(root, archive, 'manifest.json')));
test('daily Agent tools and historical acceptance scripts remain separated with no lost entries', () => {
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'scripts/agent')).sort(),
    [...manifest.dailyFiles, 'layout.test.mjs', 'README.md'].sort(),
  );
  assert.equal(
    new Set(manifest.entries.map((entry) => entry.original)).size,
    manifest.entries.length,
  );
  for (const entry of manifest.entries) {
    assert(fs.statSync(path.join(root, entry.path)).isFile(), entry.path);
    assert.equal(fs.existsSync(path.join(root, entry.original)), false, entry.original);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
});

test('every relative import in relocated tools still resolves, including ordinary packaging dependencies', () => {
  for (const entry of manifest.entries.filter((item) => /\.[cm]js$/.test(item.path))) {
    const filename = path.join(root, entry.path),
      source = fs.readFileSync(filename, 'utf8');
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    assert.equal(ast.parseDiagnostics.length, 0, entry.path);
    const visit = (node) => {
      let value;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        value = node.moduleSpecifier;
      else if (
        ts.isCallExpression(node) &&
        [ts.SyntaxKind.ImportKeyword, ts.SyntaxKind.Identifier].includes(node.expression.kind) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(ast) === 'require')
      )
        value = node.arguments[0];
      if (
        ts.isCallExpression(node) &&
        /^path\.(?:resolve|join)$/.test(node.expression.getText(ast)) &&
        node.arguments[0]?.getText(ast) === '__dirname' &&
        node.arguments.slice(1).every(ts.isStringLiteral)
      ) {
        const target = path.resolve(
          path.dirname(filename),
          ...node.arguments.slice(1).map((item) => item.text),
        );
        assert(fs.existsSync(target), entry.path + ': ' + target);
      }
      if (value && ts.isStringLiteral(value) && value.text.startsWith('.')) {
        const target = path.resolve(path.dirname(filename), value.text);
        let resolved = fs.existsSync(target);
        if (!resolved && ts.isCallExpression(node) && node.expression.getText(ast) === 'require') {
          try {
            createRequire(filename).resolve(value.text);
            resolved = true;
          } catch {}
          // CI checks tool layout before compiling workspace dist directories.
          if (!resolved && target.includes(path.sep + 'dist' + path.sep)) {
            const source = target.replace(
              path.sep + 'dist' + path.sep,
              path.sep + 'src' + path.sep,
            );
            resolved =
              fs.existsSync(source + '.ts') || fs.existsSync(path.join(source, 'index.ts'));
          }
        }
        assert(resolved, entry.path + ': ' + value.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
});

test('CI and desktop packaging continue to invoke existing daily tools', () => {
  for (const filename of [
    '.github/workflows/agent-tests.yml',
    '.github/workflows/desktop-smoke.yml',
    '.github/workflows/release.yml',
    'apps/desktop/scripts/stage-agent.mjs',
  ]) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    for (const [file] of source.matchAll(/scripts\/agent\/[\w.-]+\.(?:mjs|cjs|json|sh)/g))
      assert(fs.existsSync(path.join(root, file)), filename + ': ' + file);
  }
});

test('archive launcher catalogs actual commands and rejects unknown commands without evaluating them', (t) => {
  const script = path.join(root, archive, 'run.mjs');
  const listed = spawnSync(process.execPath, [script, 'list'], {
    encoding: 'utf8',
    cwd: path.dirname(root),
  });
  assert.equal(listed.status, 0, listed.stderr);
  const commands = JSON.parse(listed.stdout);
  assert.equal(commands.length, manifest.entries.filter((entry) => entry.command).length);
  assert(commands.some((item) => item.command === 'p0-git-bindings'));
  const rejected = spawnSync(process.execPath, [script, '../package.mjs'], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Unknown archived command/);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-archive-launcher-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'must-not-be-created.json');
  const guarded = spawnSync(process.execPath, [script, 'p0-git-bindings', output], {
    encoding: 'utf8',
  });
  assert.equal(guarded.status, 1);
  assert.match(guarded.stderr, /HEAD needs fresh manual review/);
  assert.equal(fs.existsSync(output), false);
});
