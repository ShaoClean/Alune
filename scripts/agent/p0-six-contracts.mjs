// Independent working-tree replay for the first six failed P0 contracts.
// Raw retired signatures and semantic gaps are retained; no same-HEAD release
// merge is performed across different working-tree inputs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from 'node:test';
import {
  validateLedger,
  validateBindings,
  assertedRuns,
  missingProgress,
} from './p0-test-receipts.mjs';
import { readPolicy } from './acceptance-policy.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = (data) =>
  JSON.stringify(
    data,
    (key, value) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value,
    2,
  ) + '\n';
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sourceRoots = [
  'apps/web/src',
  'packages/agent/src',
  'packages/agent-client/src',
  'packages/protocol/src',
  'packages/domain/src',
];
const testFile = 'apps/web/tests/p0-six-contracts.test.mjs';
const scenarios = [
  [
    'P0-REPOSITORIES-2158',
    'WorkspaceData',
    [
      'P0 WorkspaceData preserves the frozen public declaration in both directions without new any positions',
      'P0 WorkspaceData retains aggregate errors while panel errors and repository lifetimes remain isolated',
    ],
    'The original public WorkspaceData declaration is compatible in both directions without additional any positions. Actual workspace factories retain aggregate errors; independent panel errors and late-response lifetime isolation remain intact.',
    'Public declaration and selected store transitions only; internal panelErrors are supplied by the store extension. No complete UI or clean-HEAD claim.',
  ],
  [
    'P0-PROTOCOL-2302',
    'ConnectionStatusEvent',
    [
      'P0 ConnectionStatusEvent projects frozen fields from sequenced Agent events and ignores stale or malformed host status',
    ],
    'Four frozen connection status/error/time samples project from real AgentSession/EventQueue/AgentClient envelopes to the UI connection store. Stale status, other-host isolation and malformed payload rejection are asserted.',
    'Synthetic host status publisher through real in-memory Agent transport and the production UI subscription. No new physical SSH, native installation or all-host acceptance. Raw retired type signature remains absent.',
  ],
  [
    'P0-PROTOCOL-2303',
    'RepositoryStatusEvent',
    [
      'P0 RepositoryStatusEvent successor invalidates only its owning resource and re-reads the frozen status summary',
    ],
    'A sequenced resource change invalidates the owning Agent read and re-reads current branch/ahead/behind/dirty fields equal to the frozen gateway payload. A second Agent with the same resourceId stays isolated; control resync and cleanup callbacks are asserted.',
    'Synthetic repository reads and in-memory Agent sessions; no automatic repo:status compatibility callback or real filesystem watcher is claimed. Raw retired type signature remains absent.',
  ],
];
const unresolved = {
  'P0-PROTOCOL-2300':
    'No equivalent raw stdout/stderr command stream: repositories.operation is coalescible, redacted bounded progress. The frozen emitter has no business callers, but absence of callers is not authorization to waive the original mapping requirement.',
  'P0-PROTOCOL-2301':
    'No equivalent command text plus numeric process exitCode projection: RPC/task outcome is a different contract. The frozen emitter has no business callers; an explicit retirement disposition or equivalent successor remains required.',
  'P0-PROTOCOL-2304':
    'ServerEvents has partial successor coverage only. Its connection and repository entries have scoped assertions; command output/exit still lack equivalent projections or an approved retirement disposition.',
};

export async function main(args) {
  if (args.length !== 1)
    throw Error('Usage: node scripts/agent/p0-six-contracts.mjs NEW_OUTPUT_DIRECTORY');
  const output = path.resolve(args[0]);
  if (!output.startsWith(root) || fs.existsSync(output))
    throw Error('Expected a fresh output directory inside the workspace');
  const ledgerFile = path.join(root, 'docs/acceptance/issue-257-258/8f30e6b/ledger.json');
  const previousFile = path.join(
    root,
    'docs/acceptance/issue-257-258/continuation-20261113-mac/release-evidence/receipts.json',
  );
  const progressFile = path.join(path.dirname(previousFile), 'missing-progress.json');
  const policyFile = path.join(root, 'scripts/agent/acceptance-mac-arm64.json');
  const ledger = read(ledgerFile),
    previous = read(previousFile),
    progress = read(progressFile),
    policy = readPolicy(policyFile);
  validateLedger(ledger);
  const target = process.platform + '-' + process.arch,
    sha = git('rev-parse', 'HEAD').trim();
  if (!policy.localProofs || !policy.requiredTargets.includes(target))
    throw Error('Unsupported local proof target');
  const selectedIds = new Set([...scenarios.map((s) => s[0]), ...Object.keys(unresolved)]);
  const rows = progress.rows.filter((row) => selectedIds.has(row.scenarioId));
  if (rows.length !== 6 || rows.some((row) => row.status !== 'nonpassing-current-assertion'))
    throw Error('Expected exactly the original six failed contracts');
  const tests = [
    ...walk(path.join(root, 'apps/web/tests')).filter((f) => /\.test\.mjs$/.test(f)),
    ...['packages/agent/tests/events.test.cjs', 'packages/agent-client/tests/client.test.cjs'].map(
      (f) => path.join(root, f),
    ),
  ];
  const tooling = [
    'scripts/agent/p0-six-contracts.mjs',
    'scripts/agent/check-p0-models.mjs',
    'scripts/agent/p0-test-receipts.mjs',
    'scripts/agent/acceptance-policy.mjs',
    'scripts/agent/acceptance-mac-arm64.json',
    'apps/web/tests/resolve-ts.mjs',
    'packages/ui/tests/resolve-ts.mjs',
    'scripts/agent/check-boundaries.mjs',
    'scripts/agent/retirement.test.mjs',
  ];
  const files = [
    ...new Set([
      ...sourceRoots.flatMap((dir) => walk(path.join(root, dir))),
      ...walk(path.join(root, 'packages/ui/src')),
      ...walk(path.join(root, 'packages/ui/tests')),
      ...walk(path.join(root, 'apps/web/tests')),
      ...tests,
      ...tooling.map((f) => path.join(root, f)),
      ...git('ls-files', '*package.json', '*tsconfig*.json', 'package-lock.json', 'tsconfig.json')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((f) => path.join(root, f)),
    ]),
  ].sort();
  const inputs = Object.fromEntries(
    files.map((file) => [path.relative(root, file), hash(fs.readFileSync(file))]),
  );
  const sourceFingerprint = hash(json(inputs));
  fs.mkdirSync(output, { recursive: true });
  const write = (file, data) => fs.writeFileSync(path.join(output, file), json(data));
  fs.mkdirSync(path.join(output, 'logs'));
  fs.mkdirSync(path.join(output, 'historical'));
  const historical = [];
  for (const row of rows)
    for (const assertion of row.assertions) {
      const original = path.resolve(path.dirname(progressFile), assertion.proof.path);
      const bytes = fs.readFileSync(original);
      if (hash(bytes) !== assertion.proof.sha256 || assertion.result !== 'failed')
        throw Error('Historical failure proof changed');
      const name = path.basename(original);
      const destination = path.join(output, 'historical', name);
      if (fs.existsSync(destination) && hash(fs.readFileSync(destination)) !== hash(bytes))
        throw Error('Historical proof name collision');
      fs.writeFileSync(destination, bytes);
      historical.push({
        scenarioId: row.scenarioId,
        original,
        assertion,
        copy: 'historical/' + name,
      });
    }
  write('historical-failures.json', {
    previous: { path: previousFile, sha256: hash(fs.readFileSync(previousFile)) },
    progress: { path: progressFile, sha256: hash(fs.readFileSync(progressFile)) },
    rows: historical,
  });
  const dirty = git('status', '--porcelain=v1');
  write('retired-path-inventory.json', {
    collectedBeforeBuild: true,
    tracked: git('ls-files', 'apps/server', 'packages/shared', 'packages/ssh-client'),
    paths: Object.fromEntries(
      ['apps/server', 'packages/shared', 'packages/ssh-client'].map((dir) => [
        dir,
        fs.existsSync(path.join(root, dir))
          ? walk(path.join(root, dir)).map((file) => ({
              path: path.relative(root, file),
              sha256: hash(fs.readFileSync(file)),
            }))
          : [],
      ]),
    ),
    limitation:
      'Pre-existing ignored remnants are inventoried, not loaded, removed or restored by this replay. Their presence can fail the strict retirement gate.',
  });
  write('source-state.json', {
    kind: 'working-tree',
    head: sha,
    dirty: true,
    sourceFingerprint,
    inputs,
    node: process.version,
    nodeExecutable: process.execPath,
    nodeSha256: hash(fs.readFileSync(process.execPath)),
    target,
    policy: policy.id,
    startedAt: new Date().toISOString(),
    status: dirty,
    limitations:
      'HEAD identifies ancestry only. Exact working-tree bytes are identified by sourceFingerprint and inputs. Do not merge these runs with historical same-HEAD runs as a clean release proof.',
  });
  const snapshot = [
    'apps/web/src/stores/repositoryStore.ts',
    'apps/web/src/hooks/useSocket.ts',
    'apps/web/src/api/workspace-events.ts',
    testFile,
    ...tooling,
  ];
  for (const file of new Set(snapshot)) {
    const destination = path.join(output, 'source-snapshot', file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  fs.writeFileSync(
    path.join(output, 'working-tree.patch'),
    git('diff', '--', 'apps/web/src/stores/repositoryStore.ts', 'apps/web/src/hooks/useSocket.ts'),
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-six-replay-'));
  const results = [];
  try {
    const archive = execFileSync(
      'git',
      [
        'archive',
        ledger.sha,
        'packages/shared/src',
        'apps/web/src',
        'apps/server/src/events/events.gateway.ts',
      ],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 },
    );
    execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
    const frozenInputs = Object.fromEntries(
      walk(temporary)
        .sort()
        .map((file) => [path.relative(temporary, file), hash(fs.readFileSync(file))]),
    );
    write('frozen-inputs.json', { baseline: ledger.sha, inputs: frozenInputs });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    const command = (name, executable, args, independentGate = false) => {
      const log = 'logs/' + name + '.log',
        fd = fs.openSync(path.join(output, log), 'wx');
      const startedAt = new Date().toISOString();
      const result = spawnSync(executable, args, {
        cwd: root,
        stdio: ['ignore', fd, fd],
        timeout: 180000,
        env: {
          ...process.env,
          PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        },
      });
      fs.closeSync(fd);
      results.push({
        name,
        executable,
        args,
        cwd: root,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: result.status,
        signal: result.signal,
        error: result.error?.message,
        log: { path: log, sha256: hash(fs.readFileSync(path.join(output, log))) },
      });
      write('commands.json', results);
      if (result.status !== 0 && !independentGate)
        throw Error(name + ' failed; original log retained');
    };
    command('core-build', process.execPath, [
      'node_modules/typescript/bin/tsc',
      '-b',
      'packages/domain',
      'packages/protocol',
      'packages/agent-client',
      'packages/agent',
      '--force',
    ]);
    command('web-types', process.execPath, [
      'node_modules/typescript/bin/tsc',
      '-b',
      'apps/web',
      '--force',
    ]);
    command('boundaries', process.execPath, ['scripts/agent/check-boundaries.mjs']);
    // A separate strict gate can fail on pre-existing ignored artifacts. Keep its
    // failure and continue the independently scoped source assertions.
    command('retirement', process.execPath, ['--test', 'scripts/agent/retirement.test.mjs'], true);
    const builtInputs = Object.fromEntries(
      [
        'packages/domain/dist',
        'packages/protocol/dist',
        'packages/agent-client/dist',
        'packages/agent/dist',
      ]
        .flatMap((dir) => walk(path.join(root, dir)))
        .sort()
        .map((file) => [path.relative(root, file), hash(fs.readFileSync(file))]),
    );
    write('built-inputs.json', { inputs: builtInputs });
    const source = fs.readFileSync(path.join(root, testFile), 'utf8');
    const testRef = (name) => {
      const index = source.indexOf("test('" + name + "'");
      if (index < 0) throw Error('Missing exact reviewed test: ' + name);
      return { file: testFile, name, line: source.slice(0, index).split('\n').length };
    };
    const plan = {
      schemaVersion: 1,
      sha,
      sourceFingerprint,
      bindings: scenarios.map(([id, name, names, assertion, limitations]) => ({
        entries: [rows.find((row) => row.scenarioId === id).id],
        assertion,
        limitations,
        tests: names.map(testRef),
        implementation: [
          'apps/web/src/stores/repositoryStore.ts',
          'apps/web/src/api/workspace-events.ts',
          'apps/web/src/api/agent-repositories.ts',
          'apps/web/src/stores/connectionStore.ts',
        ],
      })),
    };
    validateBindings(ledger, plan);
    write('plan.json', plan);
    process.env.P0_SIX_BASELINE_DIR = temporary;
    process.env.P0_SIX_PROOF_DIR = output;
    const events = [];
    const stream = run({
      files: tests,
      concurrency: 2,
      timeout: 120000,
      execArgv: ['--import', path.join(root, 'apps/web/tests/resolve-ts.mjs')],
    });
    for await (const event of stream) events.push(event);
    delete process.env.P0_SIX_BASELINE_DIR;
    delete process.env.P0_SIX_PROOF_DIR;
    const eventBytes = json(events);
    fs.writeFileSync(path.join(output, 'test-events.json'), eventBytes);
    const summary = events.findLast((event) => event.type === 'test:summary' && !event.data.file);
    write('test-summary.json', summary?.data ?? {});
    if (!summary?.data.success || events.some((event) => event.type === 'test:fail'))
      throw Error('Test batch failed; original event stream retained');
    for (const [file, digest] of Object.entries(inputs))
      if (hash(fs.readFileSync(path.join(root, file))) !== digest)
        throw Error('Source changed during replay: ' + file);
    for (const [file, digest] of Object.entries(builtInputs))
      if (hash(fs.readFileSync(path.join(root, file))) !== digest)
        throw Error('Built input changed during replay: ' + file);
    if (git('rev-parse', 'HEAD').trim() !== sha) throw Error('HEAD changed during replay');
    const attachments = [
      'workspace-types.json',
      'workspace-runtime.json',
      'connection-projection.json',
      'repository-projection.json',
      'retired-event-review.json',
      'source-state.json',
      'built-inputs.json',
      'frozen-inputs.json',
      'plan.json',
      'historical-failures.json',
    ].map((file) => ({ path: file, sha256: hash(fs.readFileSync(path.join(output, file))) }));
    const proof = {
      kind: 'working-tree',
      sha,
      sourceFingerprint,
      target,
      baseline: ledger.sha,
      events: { path: 'test-events.json', sha256: hash(eventBytes) },
      results,
      independentGateFailures: results
        .filter((result) => result.exitCode !== 0)
        .map(({ name, exitCode, log }) => ({ name, exitCode, log })),
      attachments,
      summary: summary.data,
      unresolved,
      releaseEligible: false,
      limitations:
        'Scoped local assertions and explicit semantic gaps only. No raw retired command stream/exit parity, complete feature, clean checkout, native upgrade/rollback/update or cross-platform pass.',
    };
    write('batch-proof.json', proof);
    const proofRef = {
      path: 'batch-proof.json',
      sha256: hash(fs.readFileSync(path.join(output, 'batch-proof.json'))),
    };
    const runs = assertedRuns(plan, events, root, target, proofRef).map((run) => ({
      ...run,
      sourceKind: 'working-tree',
      sourceFingerprint,
    }));
    const gapTest = testRef(
      'P0 retired command output and exit declarations remain explicit gaps instead of fabricated Agent parity',
    );
    for (const [scenarioId, reason] of Object.entries(unresolved))
      runs.push({
        sha,
        target,
        sourceKind: 'working-tree',
        sourceFingerprint,
        entries: [rows.find((row) => row.scenarioId === scenarioId).id],
        result: 'failed',
        scenario: scenarioId + ': successor parity review',
        assertion: reason,
        limitations: proof.limitations,
        tests: [gapTest],
        proof: proofRef,
      });
    const receipts = {
      stage: 'after-retirement',
      policy: policy.id,
      sha,
      sourceKind: 'working-tree',
      sourceFingerprint,
      baseline: ledger.sha,
      releaseEligible: false,
      runs,
    };
    write('receipts.json', receipts);
    const current = missingProgress(ledger, previous, receipts);
    current.sourceKind = 'working-tree';
    current.sourceFingerprint = sourceFingerprint;
    current.limitations.push(
      'Historical failed signatures are retained in historical-failures.json. Successor scoped assertions do not change their original results.',
    );
    write('missing-progress.json', current);
    write('summary.json', {
      ...current.summary,
      tests: summary.data.counts,
      sourceKind: 'working-tree',
      sourceFingerprint,
      releaseEligible: false,
      independentGateFailures: proof.independentGateFailures,
      unresolved,
      finishedAt: new Date().toISOString(),
    });
    console.log(
      json({
        ...current.summary,
        tests: summary.data.counts,
        sourceFingerprint,
        releaseEligible: false,
      }),
    );
    if (Object.keys(unresolved).length || results.some((result) => result.exitCode !== 0))
      process.exitCode = 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
