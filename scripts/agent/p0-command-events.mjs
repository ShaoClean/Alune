// Independent batch-02 replay. Historical associations are progress only, never
// combined into a same-source release receipt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from 'node:test';
import { validateLedger, validateBindings, assertedRuns } from './p0-test-receipts.mjs';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = (v) =>
  JSON.stringify(
    v,
    (_k, x) => (x instanceof Error ? { name: x.name, message: x.message, stack: x.stack } : x),
    2,
  ) + '\n';
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const git = (...a) =>
  execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const walk = (p) =>
  fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : [path.join(p, e.name)]));
const digestFiles = (files) =>
  Object.fromEntries(
    [...new Set(files)].sort().map((f) => [path.relative(root, f), hash(fs.readFileSync(f))]),
  );
const testFile = 'apps/web/tests/p0-command-events.test.mjs';
const changes = [
  'packages/protocol/src/command-events.ts',
  'packages/protocol/src/index.ts',
  'packages/agent/src/ports/process.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/runtime/command-events.ts',
  'packages/agent/src/bootstrap/repository-writes.ts',
  'apps/web/src/api/ui-agent.ts',
  'apps/web/src/api/workspace-events.ts',
  testFile,
  'scripts/agent/p0-command-events.mjs',
];
const prior = 'docs/acceptance/issue-257-258/batch-01-six-contracts-20261113/replay-03';
const older =
  'docs/acceptance/issue-257-258/continuation-20261113-mac/release-evidence/receipts.json';
const limitation =
  'Scoped local darwin-arm64 successor assertions on an exact dirty working tree. Legacy type exports stay retired. Native Git repository writes only; no universal shell/PTY/legacy SSH executor, historical stream replay, physical SSH or other-platform acceptance. Agent ID replaces connection routing identity; resource ID replaces repository routing identity. No release, install, upgrade, rollback or clean-HEAD claim.';
export async function main(args) {
  if (args.length !== 1)
    throw Error('Usage: node scripts/agent/p0-command-events.mjs NEW_OUTPUT_DIRECTORY');
  const output = path.resolve(args[0]);
  if (!output.startsWith(root + path.sep) || fs.existsSync(output))
    throw Error('Expected fresh workspace output directory');
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(output, 'logs'));
  const write = (p, v) => fs.writeFileSync(path.join(output, p), json(v));
  const sha = git('rev-parse', 'HEAD').trim(),
    target = process.platform + '-' + process.arch;
  const ledger = read('docs/acceptance/issue-257-258/8f30e6b/ledger.json');
  validateLedger(ledger);
  const previous = read(prior + '/receipts.json'),
    progress = read(prior + '/missing-progress.json'),
    historical = read(older);
  const associations = new Set(
    [...historical.runs, ...previous.runs]
      .filter((r) => r.result === 'passed')
      .flatMap((r) => r.entries),
  );
  const missing = ledger.entries.filter((r) => !associations.has(r.id));
  if (missing.length !== 681) throw Error('Expected 681 unassociated entries before batch 02');
  const tests = [
    ...walk(path.join(root, 'apps/web/tests')).filter((f) => f.endsWith('.test.mjs')),
    ...walk(path.join(root, 'packages/protocol/tests')).filter((f) => f.endsWith('.test.cjs')),
    ...walk(path.join(root, 'packages/agent-client/tests')).filter((f) => f.endsWith('.test.cjs')),
    ...[
      'events',
      'repository-writes',
      'git-local-connection',
      'git-local-git-proxy',
      'git-local-git-partial-proxy',
    ].map((f) => path.join(root, 'packages/agent/tests', f + '.test.cjs')),
  ].sort();
  const sourceDirs = [
    'apps/web/src',
    'apps/web/tests',
    'packages/ui/src',
    'packages/ui/tests',
    'packages/domain/src',
    'packages/protocol/src',
    'packages/protocol/tests',
    'packages/agent-client/src',
    'packages/agent-client/tests',
    'packages/agent/src',
    'packages/agent/tests',
  ];
  const files = [
    ...sourceDirs.flatMap((d) => walk(path.join(root, d))),
    ...walk(path.join(root, 'scripts/agent')),
    ...git('ls-files', '*package.json', '*tsconfig*.json', 'package-lock.json', 'tsconfig.json')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((f) => path.join(root, f)),
  ];
  const inputs = digestFiles(files),
    sourceFingerprint = hash(json(inputs));
  const source = {
    kind: 'working-tree',
    head: sha,
    sourceFingerprint,
    inputs,
    node: process.version,
    nodeExecutable: process.execPath,
    nodeSha256: hash(fs.readFileSync(process.execPath)),
    target,
    startedAt: new Date().toISOString(),
    status: git('status', '--porcelain=v1'),
    limitations: limitation,
  };
  write('source-state.json', source);
  for (const file of changes) {
    const to = path.join(output, 'source-snapshot', file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, file), to);
  }
  fs.writeFileSync(path.join(output, 'working-tree.patch'), git('diff', '--', ...changes));
  write(
    'historical-inputs.json',
    [
      older,
      prior + '/receipts.json',
      prior + '/missing-progress.json',
      prior + '/batch-proof.json',
    ].map((p) => ({
      path: p,
      sha256: hash(fs.readFileSync(path.join(root, p))),
      sourceFingerprint: read(p).sourceFingerprint,
      releaseEligible: false,
    })),
  );
  const commands = [];
  const command = (name, argv, independent = false) => {
    const log = 'logs/' + name + '.log',
      fd = fs.openSync(path.join(output, log), 'wx'),
      startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, argv, {
      cwd: root,
      stdio: ['ignore', fd, fd],
      timeout: 240000,
      env: {
        ...process.env,
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
      },
    });
    fs.closeSync(fd);
    commands.push({
      name,
      executable: process.execPath,
      args: argv,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message,
      log: { path: log, sha256: hash(fs.readFileSync(path.join(output, log))) },
    });
    write('commands.json', commands);
    if (result.status !== 0 && !independent) throw Error('Check failed: ' + name);
  };
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
  const built = digestFiles(
    [
      'packages/domain/dist',
      'packages/protocol/dist',
      'packages/agent-client/dist',
      'packages/agent/dist',
    ].flatMap((d) => walk(path.join(root, d))),
  );
  write('built-inputs.json', { inputs: built });
  const sourceText = fs.readFileSync(path.join(root, testFile), 'utf8');
  const names = [...sourceText.matchAll(/test\(\s*'([^']+)'/g)].map((m) => ({
    file: testFile,
    name: m[1],
    line: sourceText.slice(0, m.index).split('\n').length,
  }));
  if (names.length !== 8) throw Error('Expected eight reviewed targeted tests');
  const firstNames = (indices) => indices.map((i) => names[i]);
  const plan = {
    schemaVersion: 1,
    sha,
    sourceFingerprint,
    nodeImports: ['apps/web/tests/resolve-ts.mjs'],
    reviewedTooling: { [testFile]: hash(fs.readFileSync(path.join(root, testFile))) },
    bindings: [
      [
        'P0-PROTOCOL-2300',
        [0, 1, 2, 6, 7],
        'Real native Git stdout/stderr bytes traverse reliable ACKed Agent envelopes without coalescing; incremental UTF-8 compatibility callbacks match frozen emitter fields and remain isolated by resource.',
      ],
      [
        'P0-PROTOCOL-2301',
        [0, 2, 3, 5, 6],
        'Native close status supplies command text and exact numeric exit codes 0/1/7/128; hook failure is compared with actual Git. Null signal termination and spawn failure never fabricate numeric status; duplicate operation IDs do not execute again.',
      ],
      [
        'P0-PROTOCOL-2304',
        [0, 1, 2, 3, 4, 5, 6, 7],
        'The four retired event categories have scoped successor mappings: hosts.changed, repository invalidation plus read, commands.output, commands.exit. Command streams carry Agent/session/sequence/resource identity; first-batch status assertions are rerun on this source.',
      ],
    ].map(([scenarioId, indices, assertion]) => ({
      entries: [ledger.entries.find((r) => r.scenarioId === scenarioId).id],
      tests: firstNames(indices),
      assertion,
      limitations: limitation,
      implementation: changes.filter((f) => f.endsWith('.ts')),
    })),
  };
  validateBindings(ledger, plan);
  write('plan.json', plan);
  process.env.P0_COMMAND_PROOF_DIR = output;
  const events = [];
  const startedAt = new Date().toISOString();
  try {
    for await (const e of run({
      files: tests,
      concurrency: 2,
      timeout: 120000,
      execArgv: ['--import', path.join(root, 'apps/web/tests/resolve-ts.mjs')],
    }))
      events.push(e);
  } finally {
    delete process.env.P0_COMMAND_PROOF_DIR;
  }
  write('test-events.json', events);
  const summary = events.findLast((e) => e.type === 'test:summary' && !e.data.file)?.data;
  write('test-summary.json', summary ?? {});
  if (!summary?.success || events.some((e) => e.type === 'test:fail'))
    throw Error('Test batch failed; full machine event log retained');
  for (const [f, h] of Object.entries(inputs))
    if (hash(fs.readFileSync(path.join(root, f))) !== h)
      throw Error('Source changed during replay: ' + f);
  for (const [f, h] of Object.entries(built))
    if (hash(fs.readFileSync(path.join(root, f))) !== h)
      throw Error('Built input changed during replay: ' + f);
  if (git('rev-parse', 'HEAD').trim() !== sha) throw Error('HEAD changed during replay');
  const attachments = [
    'raw-and-frozen',
    'backpressure',
    'authorized-writes',
    'cancel-and-start-failure',
    'event-set',
    'numeric-exits',
    'delivery-failure',
    'projection-isolation',
    'source-state',
    'built-inputs',
    'historical-inputs',
    'plan',
  ].map((n) => ({
    path: n + '.json',
    sha256: hash(fs.readFileSync(path.join(output, n + '.json'))),
  }));
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
    attachments,
    commands,
    limitations: limitation,
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
  const currentIds = new Set(runs.flatMap((r) => r.entries));
  const current = {
    baseline: ledger.sha,
    previousSha: previous.sha,
    currentSha: sha,
    sourceKind: 'working-tree',
    sourceFingerprint,
    releaseEligible: false,
    limitations: [
      limitation,
      'Historical evidence retains original source fingerprints; association counts are not merged release evidence.',
    ],
    summary: {
      total: ledger.entries.length,
      previouslyAssociated: associations.size,
      previousMissing: missing.length,
      newlyAssertedAmongPreviousMissing: currentIds.size,
      remainingFromPreviousMissing: missing.length - currentIds.size,
      nonPassingCurrentIds: 0,
    },
    rows: missing.map((row) => ({
      ...row,
      status: currentIds.has(row.id) ? 'current-scoped-assertion' : 'needs-explicit-assertion',
      assertions: runs.filter((r) => r.entries.includes(row.id)),
      historicalAssertions: (progress.rows.find((r) => r.id === row.id)?.assertions ?? []).map(
        (a) => ({
          ...a,
          proof: a.proof
            ? { ...a.proof, path: path.relative(output, path.resolve(root, prior, a.proof.path)) }
            : undefined,
        }),
      ),
    })),
  };
  write('missing-progress.json', current);
  write('summary.json', {
    ...current.summary,
    tests: summary.counts,
    sha,
    sourceFingerprint,
    sourceKind: 'working-tree',
    target,
    releaseEligible: false,
    independentGateFailures: commands.filter((c) => c.exitCode !== 0),
  });
  console.log(
    json({
      remaining: current.summary.remainingFromPreviousMissing,
      newAssociations: currentIds.size,
      tests: summary.counts,
      sourceFingerprint,
      releaseEligible: false,
    }),
  );
  if (commands.some((c) => c.exitCode !== 0)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
