import { createCommandRecorder } from './replay-support.mjs';
// Local working-tree progress evidence only. This does not alter hosted release policy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { run } from 'node:test';
import ts from 'typescript';
import { validateLedger, validateBindings, assertedRuns } from './p0-test-receipts.mjs';
import {
  prior,
  testFile,
  modules,
  unresolved,
  limitations,
  implementation,
} from './p0-storage-lifecycle-plan.mjs';
const root = fileURLToPath(new URL("../../../", import.meta.url));
const batch = 'docs/acceptance/issue-257-258/batch-04-storage-lifecycle-20261113';
const changes = [
  'scripts/archive/agent-acceptance/replay-support.mjs',
  implementation[1],
  testFile,
  'scripts/archive/agent-acceptance/p0-storage-lifecycle-plan.mjs',
  'scripts/archive/agent-acceptance/p0-storage-lifecycle.mjs',
  'scripts/archive/agent-acceptance/p0-retired-barrels.test.mjs',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) =>
  JSON.stringify(
    value,
    (_k, v) =>
      v instanceof Error
        ? { name: v.name, message: v.message, stack: v.stack, errors: v.errors }
        : v,
    2,
  ) + '\n';
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file)));
const walk = (dir) =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const digest = (files) =>
  Object.fromEntries(
    [...new Set(files)].sort().map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]),
  );
async function main() {
  const [destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length)
    throw Error('Usage: node scripts/archive/agent-acceptance/p0-storage-lifecycle.mjs FRESH_WORKSPACE_OUTPUT');
  const output = path.resolve(destination);
  if (!output.startsWith(root) || fs.existsSync(output))
    throw Error('Expected fresh workspace output directory');
  fs.mkdirSync(path.join(output, 'logs'), { recursive: true });
  const write = (file, value) =>
    fs.writeFileSync(path.join(output, file), json(value), { flag: 'wx' });
  const previous = read(prior + '/remaining-entries.json'),
    scope = read(batch + '/scope.json');
  const ledger = read('docs/acceptance/issue-257-258/8f30e6b/ledger.json');
  validateLedger(ledger);
  if (previous.count !== 660 || previous.entries.length !== 660 || scope.scenarioIds.length !== 11)
    throw Error('Unexpected input remainder/scope');
  const selected = [...modules.map((m) => m.scenarioId), ...unresolved];
  if (new Set(selected).size !== 11 || selected.some((id) => !scope.scenarioIds.includes(id)))
    throw Error('Scope changed');
  const exact = (id) => {
    const rows = previous.entries.filter((e) => e.scenarioId === id);
    if (rows.length !== 1) throw Error('Expected exact remaining ID: ' + id);
    return rows[0];
  };
  const sha = git('rev-parse', 'HEAD').trim(),
    target = process.platform + '-' + process.arch;
  if (target !== 'darwin-arm64') throw Error('Reviewed scope is local macOS arm64');
  const dirs = [
    'packages/domain/src',
    'packages/domain/tests',
    'packages/protocol/src',
    'packages/protocol/tests',
    'packages/agent/src',
    'packages/agent/tests',
    'packages/agent-client/src',
    'packages/agent-client/tests',
    'apps/web/src',
    'apps/web/tests',
    'scripts/agent', 'scripts/archive/agent-acceptance',
  ];
  const require = createRequire(path.join(root, 'packages/agent/package.json'));
  const Database = require('better-sqlite3');
  const memory = new Database(':memory:');
  memory.close();
  const nativeFiles = Object.keys(require.cache)
    .filter((file) => file.endsWith('.node'))
    .map((file) => path.relative(root, file));
  if (nativeFiles.length !== 1 || !nativeFiles[0].includes('better-sqlite3/'))
    throw Error('Unexpected SQLite native input');
  const files = [
    ...dirs.flatMap(walk),
    ...changes,
    ...nativeFiles,
    ...git('ls-files', '*package.json', '*tsconfig*.json', 'package-lock.json')
      .trim()
      .split('\n')
      .filter(Boolean),
  ];
  const inputs = digest(files),
    sourceFingerprint = hash(json(inputs));
  write('source-state.json', {
    kind: 'working-tree',
    head: sha,
    sourceFingerprint,
    inputs,
    target,
    node: process.version,
    nodeExecutable: process.execPath,
    nodeSha256: hash(fs.readFileSync(process.execPath)),
    compiler: ts.version,
    startedAt: new Date().toISOString(),
    status: git('status', '--porcelain=v1'),
    limitations,
  });
  for (const file of changes) {
    const to = path.join(output, 'source-snapshot', file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, file), to);
  }
  fs.writeFileSync(path.join(output, 'working-tree.patch'), git('diff', '--', ...changes));
  write(
    'historical-inputs.json',
    [
      prior + '/remaining-entries.json',
      prior + '/receipts.json',
      prior + '/batch-proof.json',
      batch + '/scope.json',
      batch + '/preservation-before.json',
      batch + '/startup-regression-before.log',
      batch + '/regression-before/packages/agent/src/bootstrap/state-kernel.ts',
      batch + '/regression-before/packages/agent/dist/bootstrap/state-kernel.js',
    ].map((file) => ({
      path: file,
      sha256: hash(fs.readFileSync(path.join(root, file))),
      releaseEligible: false,
    })),
  );
  const commands = [];
  const command = createCommandRecorder({ root, output, commands });
  command('build', [
    'node_modules/typescript/bin/tsc',
    '-b',
    'packages/domain',
    'packages/protocol',
    'packages/agent-client',
    'packages/agent',
    'apps/web',
    '--force',
  ]);
  command('boundaries', ['scripts/agent/check-boundaries.mjs']);
  command('retirement', ['--test', 'scripts/agent/retirement.test.mjs'], { independent: true });
  command('diff-check', [
    '-e',
    "require('node:child_process').execFileSync('git',['diff','--check'],{stdio:'inherit'})",
  ]);
  const built = digest(
    [
      'packages/domain/dist',
      'packages/protocol/dist',
      'packages/agent-client/dist',
      'packages/agent/dist',
    ].flatMap(walk),
  );
  write('built-inputs.json', { inputs: built });
  const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch04-frozen-'));
  try {
    const archive = execFileSync(
      'git',
      ['archive', ledger.sha, 'packages/shared/src', 'apps/server/src/database'],
      { cwd: root },
    );
    execFileSync('tar', ['-xf', '-', '-C', frozen], { input: archive });
    const frozenFiles = fs
      .readdirSync(frozen, { recursive: true })
      .map((f) => path.join(frozen, f))
      .filter((f) => fs.statSync(f).isFile());
    write('frozen-inputs.json', {
      baseline: ledger.sha,
      archiveSha256: hash(archive),
      files: Object.fromEntries(
        frozenFiles.map((file) => [path.relative(frozen, file), hash(fs.readFileSync(file))]),
      ),
    });
    for (const file of frozenFiles) {
      const to = path.join(output, 'frozen-snapshot', path.relative(frozen, file));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(file, to);
    }
    const source = fs.readFileSync(path.join(root, testFile), 'utf8');
    const reference = (name) => {
      const index = source.indexOf("test('" + name + "'");
      if (index < 0) throw Error('Missing exact test: ' + name);
      return { file: testFile, name, line: source.slice(0, index).split('\n').length };
    };
    const regression = reference(
      'P0 storage failed kernel initialization releases writer without erasing corrupt state',
    );
    const cleanup = reference(
      'P0 storage shutdown releases the writer even when an owned component fails to close',
    );
    const plan = {
      schemaVersion: 1,
      sha,
      sourceFingerprint,
      reviewedTooling: { [testFile]: inputs[testFile] },
      bindings: modules.map((m) => ({
        entries: [exact(m.scenarioId).id],
        implementation,
        limitations,
        assertion: m.assertion,
        tests: [
          reference(m.name),
          ...(m.scenarioId === 'P0-STORAGE-0180' ? [reference(modules[1].name), regression] : []),
          ...(['P0-STORAGE-0182', 'P0-STORAGE-0183'].includes(m.scenarioId)
            ? [
                ...modules
                  .slice(2)
                  .filter((x) => x.scenarioId !== m.scenarioId)
                  .map((x) => reference(x.name)),
                regression,
                cleanup,
              ]
            : []),
          ...(m.scenarioId === 'P0-STORAGE-0184' ? [regression, cleanup] : []),
        ],
      })),
    };
    validateBindings(ledger, plan);
    write('plan.json', plan);
    command(
      'startup-original-regression',
      ['--test', '--test-name-pattern=failed kernel initialization', testFile],
      {
        expectedExit: 1,
        env: {
          P0_STORAGE_FROZEN: frozen,
          P0_STORAGE_KERNEL_FILE: path.join(
            root,
            batch,
            'regression-before/packages/agent/dist/bootstrap/state-kernel.js',
          ),
        },
      },
    );
    const red = fs.readFileSync(path.join(output, 'logs/startup-original-regression.log'), 'utf8');
    if (!red.includes('Agent data directory already has a writer') || !red.includes('# fail 1'))
      throw Error('Expected original writer leak regression');
    const tests = [
      testFile,
      'scripts/archive/agent-acceptance/p0-retired-barrels.test.mjs',
      'packages/agent/tests/state.test.cjs',
      'packages/agent/tests/state-cli.test.cjs',
      'packages/agent/tests/settings.test.cjs',
      'packages/agent/tests/settings-rpc.test.cjs',
      'packages/agent/tests/task-journal.test.cjs',
      'packages/agent/tests/hosts.test.cjs',
      'packages/agent/tests/events.test.cjs',
      'packages/agent/tests/recovery.test.cjs',
      'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
    ];
    process.env.P0_STORAGE_FROZEN = frozen;
    process.env.P0_STORAGE_PROOF_DIR = output;
    const events = [],
      startedAt = new Date().toISOString();
    for await (const event of run({
      files: tests.map((file) => path.join(root, file)),
      concurrency: 2,
      timeout: 120000,
    }))
      events.push(event);
    delete process.env.P0_STORAGE_FROZEN;
    delete process.env.P0_STORAGE_PROOF_DIR;
    write('test-events.json', events);
    const summary = events.findLast((e) => e.type === 'test:summary' && !e.data.file)?.data;
    write('test-summary.json', summary ?? {});
    if (
      !summary?.success ||
      summary.counts.failed ||
      summary.counts.skipped ||
      summary.counts.todo ||
      events.some((e) => e.type === 'test:fail')
    )
      throw Error('Test batch failed; no receipts issued');
    if (
      !events.some(
        (e) =>
          e.type === 'test:pass' &&
          e.data.name ===
            'P0 retired event and aggregate audit enumerates all exports without issuing compatibility passes',
      )
    )
      throw Error('Missing event/barrel audit');
    for (const [file, h] of Object.entries({ ...inputs, ...built }))
      if (hash(fs.readFileSync(path.join(root, file))) !== h)
        throw Error('Source/build drift: ' + file);
    if (git('rev-parse', 'HEAD').trim() !== sha) throw Error('HEAD drift');
    const preservation = read(batch + '/preservation-before.json');
    const changed = [],
      missing = [];
    for (const [file, h] of Object.entries(preservation.files)) {
      if (!fs.existsSync(path.join(root, file))) missing.push(file);
      else if (hash(fs.readFileSync(path.join(root, file))) !== h) changed.push(file);
    }
    if (missing.length || changed.some((file) => file !== implementation[1]))
      throw Error('Unexpected existing-file changes: ' + json({ changed, missing }));
    write('preservation-check.json', {
      before: Object.keys(preservation.files).length,
      changed,
      missing,
      unchanged: Object.keys(preservation.files).length - changed.length - missing.length,
    });
    const proof = {
      sourceKind: 'working-tree',
      sha,
      sourceFingerprint,
      target,
      startedAt,
      finishedAt: new Date().toISOString(),
      tests: summary.counts,
      events: {
        path: 'test-events.json',
        sha256: hash(fs.readFileSync(path.join(output, 'test-events.json'))),
      },
      attachments: [
        'source-state',
        'built-inputs',
        'frozen-inputs',
        'historical-inputs',
        'plan',
        'event-barrel-audit',
        'preservation-check',
      ].map((p) => ({
        path: p + '.json',
        sha256: hash(fs.readFileSync(path.join(output, p + '.json'))),
      })),
      commands,
      limitations,
      releaseEligible: false,
    };
    write('batch-proof.json', proof);
    const proofRef = {
      path: 'batch-proof.json',
      sha256: hash(fs.readFileSync(path.join(output, 'batch-proof.json'))),
    };
    const runs = assertedRuns(plan, events, root, target, proofRef).map((r) => ({
      ...r,
      sourceKind: 'working-tree',
      sourceFingerprint,
    }));
    const done = new Set(runs.flatMap((r) => r.entries));
    if (done.size !== 8) throw Error('Expected exactly eight storage assertions');
    write('receipts.json', {
      stage: 'after-retirement',
      baseline: ledger.sha,
      sha,
      sourceKind: 'working-tree',
      sourceFingerprint,
      releaseEligible: false,
      runs,
    });
    write('scope-results.json', {
      selected: 11,
      passed: done.size,
      unresolved: 3,
      results: scope.entries.map((e) => ({
        ...e,
        status: done.has(e.id) ? 'current-scoped-assertion' : 'unresolved-retired-aggregate',
        reason: done.has(e.id)
          ? undefined
          : 'All frozen fields and barrel exports audited; retired events are not literally compatible. See event-barrel-audit.json; prior scoped successor assertions do not imply a module pass.',
        assertions: runs.filter((r) => r.entries.includes(e.id)),
      })),
      releaseEligible: false,
    });
    const remaining = previous.entries.filter((e) => !done.has(e.id));
    write('remaining-entries.json', {
      sourceFingerprint,
      count: remaining.length,
      byAssignment: Object.fromEntries(
        [...new Set(remaining.map((e) => e.assignment))]
          .sort()
          .map((a) => [a, remaining.filter((e) => e.assignment === a).length]),
      ),
      entries: remaining,
      releaseEligible: false,
    });
    write('missing-progress.json', {
      baseline: ledger.sha,
      sourceFingerprint,
      releaseEligible: false,
      summary: {
        previousMissing: 660,
        newlyAssertedAmongPreviousMissing: done.size,
        remainingFromPreviousMissing: remaining.length,
      },
      rows: previous.entries.map((e) => ({
        ...e,
        status: done.has(e.id) ? 'current-scoped-assertion' : e.status,
        assertions: runs.filter((r) => r.entries.includes(e.id)),
        historicalAssertions: e.historicalAssertions ?? [],
      })),
    });
    const gates = commands.filter((c) => c.independent && c.exitCode !== c.expectedExit);
    const result = {
      selected: 11,
      passed: done.size,
      unresolved: 3,
      remaining: remaining.length,
      tests: summary.counts,
      sourceFingerprint,
      proofSha256: proofRef.sha256,
      independentGateFailures: gates,
      releaseEligible: false,
    };
    write('summary.json', result);
    console.log(json(result));
    if (gates.length) process.exitCode = 1;
  } finally {
    delete process.env.P0_STORAGE_FROZEN;
    delete process.env.P0_STORAGE_PROOF_DIR;
    fs.rmSync(frozen, { recursive: true, force: true });
  }
}
await main();
