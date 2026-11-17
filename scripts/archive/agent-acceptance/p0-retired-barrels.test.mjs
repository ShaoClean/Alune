// Audit evidence only: no pass receipt for these intentionally incompatible modules.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import { compareContracts } from './check-p0-models.mjs';
import { eventDifferences, unresolved } from './p0-storage-lifecycle-plan.mjs';
const frozen = process.env.P0_STORAGE_FROZEN;
assert(frozen, 'Use the batch-04 replay driver');
const root = process.cwd();
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('P0 retired event and aggregate audit enumerates all exports without issuing compatibility passes', () => {
  const expected = eventDifferences.map((row) => row.name).sort();
  const audit = unresolved.map((scenarioId, i) => {
    const suffix = ['index.ts', 'types/events.ts', 'types/index.ts'][i];
    const file = path.join(frozen, 'packages/shared/src', suffix);
    const exports = compareContracts(
      file,
      ['domain', 'protocol'].map((name) => [
        name,
        path.join(root, 'packages', name, 'src/index.ts'),
      ]),
      frozen,
      frozen,
    );
    assert.deepEqual(
      exports
        .filter((row) => !row.compatible)
        .map((row) => row.name)
        .sort(),
      expected,
    );
    assert.equal(new Set(exports.map((row) => row.name)).size, exports.length);
    if (suffix === 'types/events.ts') assert.equal(exports.length, 5);
    else assert(exports.length > 100);
    return {
      scenarioId,
      file: 'packages/shared/src/' + suffix,
      frozenSha256: hash(file),
      total: exports.length,
      compatible: exports.filter((row) => row.compatible).length,
      exports,
      status: 'unresolved-retired-aggregate',
      releaseEligible: false,
    };
  });
  const file = path.join(frozen, 'packages/shared/src/types/events.ts');
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const definitions = source.statements.filter(
    (node) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
  );
  assert.deepEqual(definitions.map((node) => node.name.text).sort(), expected);
  for (const row of eventDifferences) {
    const definition = definitions.find((node) => node.name.text === row.name);
    const fields = ts.isTypeAliasDeclaration(definition)
      ? definition.type.members
      : definition.members;
    assert.deepEqual(
      fields.map((node) => node.name.text).sort(),
      Object.keys(row.fields).sort(),
      row.name + ' must review every legacy field',
    );
  }
  const projection = ts.createSourceFile(
    'projection.ts',
    fs.readFileSync('apps/web/src/api/workspace-events.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const variable = projection.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .find((node) => node.name.text === 'workspaceEventSuccessors');
  const initializer = variable.initializer.expression;
  assert.deepEqual(
    Object.fromEntries(
      initializer.properties.map((node) => [node.name.text, node.initializer.text]),
    ),
    eventDifferences.find((row) => row.name === 'ServerEvents').fields,
  );
  if (process.env.P0_STORAGE_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_STORAGE_PROOF_DIR, 'event-barrel-audit.json'),
      JSON.stringify(
        {
          audit,
          differences: eventDifferences,
          currentSources: Object.fromEntries(
            [
              'packages/domain/src/index.ts',
              'packages/protocol/src/index.ts',
              'packages/protocol/src/command-events.ts',
              'apps/web/src/api/workspace-events.ts',
            ].map((file) => [file, hash(file)]),
          ),
          releaseEligible: false,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
});
