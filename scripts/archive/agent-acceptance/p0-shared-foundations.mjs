import { createCommandRecorder } from './replay-support.mjs';
// Batch-03 records real working-tree inputs. Historical progress never becomes
// current-source release evidence, and incomplete module audits get no receipt.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { run } from 'node:test';
import ts from 'typescript';
import { validateLedger, validateBindings, assertedRuns } from './p0-test-receipts.mjs';
import { modules, unresolved, runtimeNames, limitations } from './p0-shared-foundations-plan.mjs';

const root = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = (v) =>
  JSON.stringify(
    v,
    (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v),
    2,
  ) + '\n';
const prior = 'docs/acceptance/issue-257-258/batch-02-command-events-20261113/replay-02';
const testFile = 'scripts/archive/agent-acceptance/p0-shared-foundations.test.mjs';
const changes = [
  'scripts/archive/agent-acceptance/replay-support.mjs',
  'packages/protocol/src/pull-request-lines.ts',
  testFile,
  'scripts/archive/agent-acceptance/p0-shared-foundations-plan.mjs',
  'scripts/archive/agent-acceptance/p0-shared-foundations.mjs',
  'packages/protocol/README.md',
];
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p)));
const walk = (dir) =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const digest = (files) =>
  Object.fromEntries(
    [...new Set(files)].sort().map((f) => [f, hash(fs.readFileSync(path.join(root, f)))]),
  );

async function main() {
  const [destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length)
    throw Error('Usage: node scripts/archive/agent-acceptance/p0-shared-foundations.mjs NEW_OUTPUT_DIRECTORY');
  const output = path.resolve(destination);
  if (!output.startsWith(root) || fs.existsSync(output))
    throw Error('Expected fresh workspace output directory');
  fs.mkdirSync(path.join(output, 'logs'), { recursive: true });
  const write = (p, v) => fs.writeFileSync(path.join(output, p), json(v), { flag: 'wx' });
  const ledger = read('docs/acceptance/issue-257-258/8f30e6b/ledger.json');
  validateLedger(ledger);
  const previous = read(prior + '/remaining-entries.json');
  if (previous.count !== 678 || previous.entries.length !== 678)
    throw Error('Expected exact batch-02 remainder');
  const sha = git('rev-parse', 'HEAD').trim(),
    target = process.platform + '-' + process.arch;
  const sourceDirs = [
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
  const files = [
    ...sourceDirs.flatMap(walk),
    ...changes,
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
      'README.md',
      'replay-02/receipts.json',
      'replay-02/remaining-entries.json',
      'replay-02/batch-proof.json',
    ].map((suffix) => {
      const file = path.join(path.dirname(prior), suffix);
      return {
        path: file,
        sha256: hash(fs.readFileSync(path.join(root, file))),
        releaseEligible: false,
      };
    }),
  );
  const commands = [];
  const command = createCommandRecorder({ root, output, commands, legacy: true });
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
  command('retirement', ['--test', 'scripts/agent/retirement.test.mjs'], true);
  const built = digest(
    [
      'packages/domain/dist',
      'packages/protocol/dist',
      'packages/agent-client/dist',
      'packages/agent/dist',
    ].flatMap(walk),
  );
  write('built-inputs.json', { inputs: built });
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch03-frozen-'));
  try {
    const archive = execFileSync('git', ['archive', ledger.sha, 'packages/shared/src'], {
      cwd: root,
    });
    execFileSync('tar', ['-xf', '-', '-C', fixture], { input: archive });
    const old = path.join(fixture, 'packages/shared/src/index.ts');
    const compiler = ts.createProgram([old], {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      ignoreDeprecations: '6.0',
      strict: true,
      skipLibCheck: true,
      types: [],
      outDir: path.join(fixture, 'dist'),
      rootDir: path.dirname(old),
      noEmitOnError: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(compiler);
    if (diagnostics.length || compiler.emit().emitSkipped)
      throw Error(
        'Frozen pure model compilation failed: ' +
          diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'),
      );
    const frozenFiles = fs
      .readdirSync(path.join(fixture, 'packages/shared/src'), { recursive: true })
      .map((p) => path.join(fixture, 'packages/shared/src', p))
      .filter((p) => fs.statSync(p).isFile());
    write('frozen-inputs.json', {
      baseline: ledger.sha,
      archiveSha256: hash(archive),
      files: Object.fromEntries(
        frozenFiles.map((f) => [path.relative(fixture, f), hash(fs.readFileSync(f))]),
      ),
    });
    for (const file of frozenFiles) {
      const to = path.join(output, 'frozen-snapshot', path.relative(fixture, file));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(file, to);
    }
    const source = fs.readFileSync(path.join(root, testFile), 'utf8');
    const reference = (name, prefix = "test('" + name + "'") => {
      const index = source.indexOf(prefix);
      if (index < 0) throw Error('Missing test reference: ' + name);
      return { file: testFile, name, line: source.slice(0, index).split('\n').length };
    };
    const exact = (id) => {
      const entries = previous.entries.filter((e) => e.scenarioId === id);
      if (entries.length !== 1 || entries[0].kind !== 'source')
        throw Error('Expected one remaining source ID: ' + id);
      return entries[0];
    };
    const extension = reference(
      'P0 shared moved PR declarations and host-scoped source extensions remain explicit',
    );
    const pure = reference(
      'P0 shared public entrypoints load without host globals or external I/O modules',
    );
    const aggregate = reference(
      'P0 shared aggregate audit preserves the unresolved retired event and barrel IDs',
    );
    const plan = {
      schemaVersion: 1,
      sha,
      sourceFingerprint,
      reviewedTooling: { [testFile]: inputs[testFile] },
      bindings: modules.map((m) => ({
        entries: [exact(m.scenarioId).id],
        implementation: [m.implementation],
        limitations,
        assertion:
          'Entire pure module: every frozen export has bidirectional type/signature parity with no new any positions; non-import declarations and helpers match with explicit moved/optional/new-function exceptions; ' +
          (m.runtime ? runtimeNames[m.runtime] : 'no frozen runtime value exports') +
          '. Pure entrypoints load with host I/O denied. No generic source-file or RPC coverage claim.',
        tests: [
          reference('P0 whole shared module ' + m.scenarioId, "test('P0 whole shared module '"),
          extension,
          pure,
          aggregate,
          ...(m.runtime ? [reference(runtimeNames[m.runtime])] : []),
        ],
      })),
    };
    validateBindings(ledger, plan);
    write('plan.json', plan);
    write('scope-results-plan.json', {
      selected: [...modules, ...unresolved].map((m) => ({ ...m, entry: exact(m.scenarioId) })),
      before: 678,
    });
    const tests = [
      testFile,
      ...walk('packages/domain/tests').filter((f) => f.endsWith('.test.cjs')),
      ...walk('packages/protocol/tests').filter((f) => f.endsWith('.test.cjs')),
      ...walk('packages/agent-client/tests').filter((f) => f.endsWith('.test.cjs')),
      'packages/agent/tests/collaboration.test.cjs',
      'packages/agent/tests/p0-review-service-migration.test.cjs',
      'scripts/archive/agent-acceptance/check-p0-models.test.mjs',
      'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
    ];
    process.env.P0_SHARED_FROZEN = fixture;
    process.env.P0_SHARED_PROOF_DIR = output;
    const events = [],
      startedAt = new Date().toISOString();
    for await (const event of run({
      files: tests.map((f) => path.join(root, f)),
      concurrency: 2,
      timeout: 120000,
    }))
      events.push(event);
    delete process.env.P0_SHARED_FROZEN;
    delete process.env.P0_SHARED_PROOF_DIR;
    write('test-events.json', events);
    const summary = events.findLast((e) => e.type === 'test:summary' && !e.data.file)?.data;
    write('test-summary.json', summary ?? {});
    if (
      !summary?.success ||
      summary.counts.skipped ||
      summary.counts.todo ||
      events.some((e) => e.type === 'test:fail')
    )
      throw Error('Test batch failed; no receipts emitted');
    for (const [f, h] of Object.entries({ ...inputs, ...built }))
      if (hash(fs.readFileSync(path.join(root, f))) !== h)
        throw Error('Source/build changed during replay: ' + f);
    if (git('rev-parse', 'HEAD').trim() !== sha) throw Error('HEAD changed during replay');
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
        'module-audit',
        'pr-truncation-regression',
        'pure-runtime-imports',
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
    write('receipts.json', {
      stage: 'after-retirement',
      baseline: ledger.sha,
      sha,
      sourceKind: 'working-tree',
      sourceFingerprint,
      releaseEligible: false,
      runs,
    });
    const done = new Set(runs.flatMap((r) => r.entries)),
      remaining = previous.entries.filter((e) => !done.has(e.id));
    const results = [...modules, ...unresolved].map((m) => ({
      ...exact(m.scenarioId),
      implementation: m.implementation,
      status: done.has(exact(m.scenarioId).id)
        ? 'current-scoped-assertion'
        : 'unresolved-retired-aggregate',
      reason: m.reason,
      assertions: runs.filter((r) => r.entries.includes(exact(m.scenarioId).id)),
    }));
    write('scope-results.json', {
      selected: 21,
      passed: done.size,
      unresolved: 3,
      results,
      releaseEligible: false,
    });
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
        previousMissing: previous.count,
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
    const result = {
      selected: 21,
      passed: done.size,
      unresolved: 3,
      remaining: remaining.length,
      tests: summary.counts,
      sourceFingerprint,
      proofSha256: proofRef.sha256,
      independentGateFailures: commands.filter((c) => c.exitCode !== 0),
      releaseEligible: false,
    };
    write('summary.json', result);
    console.log(json(result));
    if (commands.some((c) => c.exitCode !== 0)) process.exitCode = 1;
  } finally {
    delete process.env.P0_SHARED_FROZEN;
    delete process.env.P0_SHARED_PROOF_DIR;
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
await main();
