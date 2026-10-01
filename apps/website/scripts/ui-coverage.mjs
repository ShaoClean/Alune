import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
// Read literal registries without executing source or depending on formatting.
function literal(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        assert.ok(ts.isPropertyAssignment(property), 'Registry properties must be literals');
        return [property.name.text, literal(property.initializer)];
      }),
    );
  throw Error('Registry values must be literal strings, numbers, arrays or objects');
}
function array(path, name) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  for (const node of source.statements)
    if (ts.isVariableStatement(node))
      for (const declaration of node.declarationList.declarations)
        if (declaration.name.getText(source) === name) return literal(declaration.initializer);
  throw Error('Missing registry ' + name);
}
const docs = array('apps/website/src/data/ui.ts', 'documents');
const examples = array('apps/website/src/examples/registry.ts', 'examples');
const exports = JSON.parse(read('apps/website/src/data/ui-exports.json'));
assert.equal(new Set(docs.map((doc) => doc.slug)).size, docs.length, 'duplicate document slug');
assert.equal(
  new Set(examples.map((example) => example.id)).size,
  examples.length,
  'duplicate example id',
);
const ids = new Set(examples.map((example) => example.id));
for (const [name, metadata] of Object.entries(exports)) {
  const document = docs.find((doc) => doc.exports.includes(name));
  assert.ok(document, `Public export ${name} has no document`);
  assert.ok(document.examples.length, `Public export ${name} has no real example`);
  assert.ok(existsSync(new URL(metadata.source, root)), `Missing source for ${name}`);
}
for (const doc of docs) {
  assert.match(doc.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(existsSync(new URL(doc.source, root)), `Missing source for ${doc.slug}`);
  for (const name of doc.exports)
    assert.ok(exports[name], `Unimplemented API ${name} in ${doc.slug}`);
  for (const id of doc.examples) assert.ok(ids.has(id), `Missing example ${id}`);
}
for (const example of examples) {
  const path = `apps/website/src/examples/${example.id}.tsx`;
  const source = read(path);
  assert.match(source, /from ['"]@alune\/ui['"]/, path);
  assert.doesNotMatch(
    source,
    /from ['"][^'"]*(?:apps\/web|\/api\/|electron|axios|socket\.io)/,
    path,
  );
  assert.ok(
    docs.some((doc) => doc.examples.includes(example.id)),
    `Orphan example ${example.id}`,
  );
}
console.log(
  `UI coverage: ${Object.keys(exports).length} exports, ${docs.length} documents, ${examples.length} real TSX examples.`,
);
