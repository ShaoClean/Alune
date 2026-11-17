import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha, reviewedBindings, makePlan, generatePlan } from './p0-git-bindings.mjs';
import { assertedRuns, validateBindings, verifyInput } from './p0-test-receipts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const archive = path.join(root, 'docs/acceptance/issue-257-258/8f30e6b');
const ledger = JSON.parse(fs.readFileSync(path.join(archive, 'ledger.json')));
const progress = JSON.parse(fs.readFileSync(path.join(archive, 'missing-progress.json')));
const plan = makePlan(ledger, progress);
const ids = plan.bindings.flatMap((row) => row.entries);

test('reviewed allowlist preserves 88 unique remaining IDs in exactly 18 frozen modules', () => {
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.sha, sha);
  assert.equal(ids.length, 88);
  assert.equal(new Set(ids).size, 88);
  assert.equal(new Set(ids.map((id) => id.split(':')[1])).size, 18);
  assert.deepEqual(ids.reduce((counts, id) => {
    const kind = id.split(':')[0];
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {}), { source: 18, export: 27, method: 43 });
  for (const row of plan.bindings) {
    assert.match(row.assertion, /assert|equal/i);
    assert.match(row.limitations, /not all methods/);
    for (const id of row.entries) assert.match(id, /^(source|export|method):packages\/ssh-client\/src\//);
  }
});

test('source and class associations never expand to unasserted helpers, types or channels', () => {
  for (const suffix of ['SSHChannelQueue.open', 'SSHChannelQueue.close', 'SSHChannelQueue.pump',
    'ConflictResolution.required', 'ConflictResolution.step', 'GitCommands._git',
    'GitCommands._changeIndex', 'GitCommands._parseBranchLine', 'GitTags.checked',
    'GitTags.ref', 'GitTags.snapshot', 'GitTags.remoteUrl', 'GitBlame.readVersion',
    'RepositoryFiles.resolve', 'StagedChanges.revision', 'WorkspaceFileActions.inspect',
    'PartialChanges.snapshot', 'PartialChanges.read', 'StatusRecord', 'CommandResult',
    'SSHConnectionOptions', 'StreamCallbacks', 'parseStatus', 'classifyChanges', 'selectedContent'])
    assert.equal(ids.some((id) => id.endsWith(':' + suffix)), false, suffix);
  assert.equal(ids.some((id) => /constructor|^channel:|packages\/shared\//.test(id)), false);
});

test('generator refuses stale progress and previously associated IDs rather than silently filtering', () => {
  assert.throws(() => makePlan(ledger, { ...progress, currentSha: '0'.repeat(40) }), /SHA/);
  const changed = structuredClone(progress);
  changed.rows.find((row) => row.id === ids[0]).status = 'current-scoped-assertion';
  assert.throws(() => makePlan(ledger, changed), /Not a remaining/);
  const duplicate = structuredClone(plan);
  duplicate.bindings.push(duplicate.bindings[0]);
  assert.throws(() => validateBindings(ledger, duplicate), /Duplicate/);
});

test('every exact test is committed unchanged and points to its test callsite', () => {
  const tests = new Map(plan.bindings.flatMap((row) => row.tests).map((item) => [JSON.stringify(item), item]));
  assert.equal(tests.size, 45);
  assert.equal(new Set([...tests.values()].map((item) => item.file)).size, 17);
  for (const item of tests.values()) {
    const bytes = fs.readFileSync(path.join(root, item.file));
    const committed = execFileSync('git', ['show', `${sha}:${item.file}`], { cwd: root });
    assert.ok(bytes.equals(committed), item.file);
    assert.match(bytes.toString().split('\n')[item.line - 1], /\btest\(/, item.name);
  }
});

test('generation pins committed business sources and fixture helpers without test-tooling exemptions', () => {
  // Reproduce the reviewed tree independently of today's HEAD or dirty edits.
  // The public generator still checks the real Git HEAD and every source byte.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-binding-review-'));
  const checkout = path.join(temporary, 'reviewed');
  execFileSync('git', ['worktree', 'add', '--detach', checkout, sha], { cwd: root, stdio: 'pipe' });
  try {
    const destination = path.join(checkout, 'docs/acceptance/issue-257-258/8f30e6b');
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ['ledger.json', 'missing-progress.json']) fs.copyFileSync(path.join(archive, file), path.join(destination, file));
    const generated = generatePlan({ sourceRoot: checkout });
    assert.deepEqual(generated.bindings.flatMap((row) => row.entries), ids);
    assert.equal(generated.reviewedTooling, undefined);
    for (const row of generated.bindings) {
      assert.ok(row.implementation.includes('packages/agent/src/adapters/git/native.ts'));
      assert.ok(row.implementation.includes('packages/domain/src/index.ts'));
      assert.ok(row.implementation.includes('packages/agent/tests/helpers/ssh-server.cjs'));
      assert.equal(row.implementation.some((file) => file.includes('/dist/')), false);
    }
    assert.throws(() => verifyInput('packages/agent/src/modules/git/git-tags.ts',
      Buffer.from('changed'), Buffer.from('committed'), generated), /changed since review/);
    fs.appendFileSync(path.join(checkout, 'packages/agent/src/adapters/git/native.ts'), '\n// controlled input drift\n');
    assert.throws(() => generatePlan({ sourceRoot: checkout }), /changed since review/);
  } finally {
    // This is the exclusively created test worktree, never the user's checkout.
    execFileSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root, stdio: 'pipe' });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('receipt runner rejects skipped, wrong-line, missing and failing exact assertions', () => {
  const scoped = { schemaVersion: 1, sha, bindings: [reviewedBindings[0]] };
  const events = scoped.bindings[0].tests.map((item) => ({ type: 'test:pass', data: {
    name: item.name, file: path.resolve(root, item.file), line: item.line, details: { type: 'test' },
  } }));
  events.push({ type: 'test:summary', data: { success: true, counts: { tests: 2, failed: 0, cancelled: 0 } } });
  assert.equal(assertedRuns(scoped, events, root, 'local', {}).length, 1);
  const skipped = structuredClone(events);
  skipped[0].data.skip = 'not supported';
  assert.throws(() => assertedRuns(scoped, skipped, root, 'local', {}), /Missing, skipped/);
  const wrongLine = structuredClone(events);
  wrongLine[0].data.line++;
  assert.throws(() => assertedRuns(scoped, wrongLine, root, 'local', {}), /Missing, skipped/);
  assert.throws(() => assertedRuns(scoped, events.slice(1), root, 'local', {}), /Missing, skipped/);
  assert.throws(() => assertedRuns(scoped, [...events, { type: 'test:fail', data: {} }], root, 'local', {}), /successfully/);
});
