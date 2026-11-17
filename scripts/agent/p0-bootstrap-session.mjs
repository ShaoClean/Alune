// Local working-tree progress only; never changes the hosted acceptance policy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from 'node:test';
import ts from 'typescript';
import { validateLedger, validateBindings, assertedRuns } from './p0-test-receipts.mjs';
import {
  batch,
  prior,
  testFile,
  modules,
  unresolved,
  implementation,
  limitations,
  regression,
  lifecycleTests,
} from './p0-bootstrap-session-plan.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (v) =>
  JSON.stringify(
    v,
    (_k, v) =>
      v instanceof Error
        ? { name: v.name, message: v.message, stack: v.stack, errors: v.errors }
        : v,
    2,
  ) + '\n';
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f)));
const walk = (dir) =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const digest = (files) =>
  Object.fromEntries(
    [...new Set(files)].sort().map((f) => [f, hash(fs.readFileSync(path.join(root, f)))]),
  );
const changes = [
  implementation[0],
  testFile,
  'scripts/agent/p0-bootstrap-session.mjs',
  'scripts/agent/p0-bootstrap-session-plan.mjs',
];
async function main() {
  const [destination, ...extra] = process.argv.slice(2);
  const output = destination && path.resolve(destination);
  if (!output || extra.length || !output.startsWith(root) || fs.existsSync(output))
    throw Error('Expected fresh workspace replay directory');
  fs.mkdirSync(path.join(output, 'logs'), { recursive: true });
  const write = (f, value) => fs.writeFileSync(path.join(output, f), json(value), { flag: 'wx' });
  const previous = read(prior + '/remaining-entries.json'),
    scope = read(batch + '/scope.json');
  const ledger = read('docs/acceptance/issue-257-258/8f30e6b/ledger.json');
  validateLedger(ledger);
  const selected = [...modules, ...unresolved].map((m) => m.scenarioId);
  if (
    previous.count !== 652 ||
    previous.entries.length !== 652 ||
    selected.length !== 7 ||
    new Set(selected).size !== 7 ||
    scope.scenarioIds.length !== 7 ||
    selected.some((id) => !scope.scenarioIds.includes(id)) ||
    hash(fs.readFileSync(path.join(root, scope.previous))) !== scope.previousSha256
  )
    throw Error('Unexpected original scope/remainder');
  const exact = (id) => {
    const matches = previous.entries.filter((e) => e.scenarioId === id);
    if (matches.length !== 1) throw Error('Missing or ambiguous original ID: ' + id);
    return matches[0];
  };
  if (json(scope.entries) !== json(previous.entries.filter((e) => selected.includes(e.scenarioId))))
    throw Error('Scope entries changed');
  const sha = git('rev-parse', 'HEAD').trim(),
    target = process.platform + '-' + process.arch;
  if (target !== 'darwin-arm64') throw Error('Only reviewed local Mac target supported');
  const require = createRequire(path.join(root, 'packages/agent/package.json'));
  const Database = require('better-sqlite3'),
    db = new Database(':memory:');
  db.close();
  const native = Object.keys(require.cache)
    .filter((f) => f.endsWith('.node'))
    .map((f) => path.relative(root, f));
  if (native.length !== 1 || !native[0].includes('better-sqlite3/'))
    throw Error('Unexpected native input');
  const files = [
    ...[
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
      'scripts/agent',
    ].flatMap(walk),
    ...changes,
    ...implementation,
    ...native,
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
  for (const f of changes) {
    const to = path.join(output, 'source-snapshot', f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
  }
  fs.writeFileSync(path.join(output, 'working-tree.patch'), git('diff', '--', ...changes));
  write(
    'historical-inputs.json',
    digest([
      prior + '/remaining-entries.json',
      prior + '/receipts.json',
      prior + '/batch-proof.json',
      batch + '/scope.json',
      batch + '/preservation-before.json',
      batch + '/reviewed-guidance.json',
      batch + '/reentrant-original-regression.log',
      batch + '/regression-before/packages/agent/src/server/session.ts',
      batch + '/regression-before/packages/agent/dist/server/session.js',
    ]),
  );
  const config = ts.readConfigFile(
    path.join(root, 'packages/agent/tsconfig.json'),
    ts.sys.readFile,
  );
  if (config.error) throw Error('Cannot read compiler config');
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.join(root, 'packages/agent'),
  );
  if (parsed.errors.length) throw Error('Cannot parse compiler config');
  const oldTs = fs.readFileSync(
    path.join(root, batch, 'regression-before/packages/agent/src/server/session.ts'),
    'utf8',
  );
  const oldJs = fs.readFileSync(
    path.join(root, batch, 'regression-before/packages/agent/dist/server/session.js'),
  );
  const emitted = Buffer.from(
    ts.transpileModule(oldTs, { compilerOptions: parsed.options, fileName: 'session.ts' })
      .outputText,
  );
  write('regression-source-check.json', {
    originalTsSha256: hash(oldTs),
    originalJsSha256: hash(oldJs),
    recompiledSha256: hash(emitted),
    byteEqual: emitted.equals(oldJs),
    compiler: ts.version,
  });
  if (!emitted.equals(oldJs))
    throw Error('Original regression JS does not match preserved TS source');
  const commands = [];
  function command(name, args, { independent = false, expectedExit = 0, env = {} } = {}) {
    const log = 'logs/' + name + '.log',
      fd = fs.openSync(path.join(output, log), 'wx');
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: ['ignore', fd, fd],
      timeout: 240000,
      env: {
        ...process.env,
        PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        ...env,
      },
    });
    fs.closeSync(fd);
    commands.push({
      name,
      executable: process.execPath,
      args,
      environmentOverrides: env,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.status,
      expectedExit,
      signal: result.signal,
      error: result.error?.message,
      independent,
      log: { path: log, sha256: hash(fs.readFileSync(path.join(output, log))) },
    });
    fs.writeFileSync(path.join(output, 'commands.json'), json(commands));
    if (result.status !== expectedExit && !independent)
      throw Error('Unexpected command result: ' + name);
  }
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
  command(
    'reentrant-original-regression',
    ['--test', '--test-name-pattern=reentrant close', testFile],
    {
      expectedExit: 1,
      env: {
        P0_BOOTSTRAP_SESSION_FILE: path.join(
          root,
          batch,
          'regression-before/packages/agent/dist/server/session.js',
        ),
      },
    },
  );
  const red = fs.readFileSync(path.join(output, 'logs/reentrant-original-regression.log'), 'utf8');
  if (
    !red.includes('Reentrant close returned an early sentinel promise') ||
    !red.includes('# fail 1')
  )
    throw Error('Expected preserved original reentrant-close failure');
  const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch05-frozen-'));
  try {
    const archive = execFileSync(
      'git',
      [
        'archive',
        ledger.sha,
        ...['app.controller', 'app.service', 'app.module', 'bootstrap', 'main'].map(
          (name) => 'apps/server/src/' + name + '.ts',
        ),
      ],
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
        frozenFiles.map((f) => [path.relative(frozen, f), hash(fs.readFileSync(f))]),
      ),
    });
    for (const f of frozenFiles) {
      const to = path.join(output, 'frozen-snapshot', path.relative(frozen, f));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(f, to);
    }
    const source = fs.readFileSync(path.join(root, testFile), 'utf8');
    const reference = (name) => {
      const needle = "test('" + name + "'",
        index = source.indexOf(needle);
      if (index < 0 || source.indexOf(needle, index + 1) >= 0)
        throw Error('Missing/ambiguous exact test: ' + name);
      return { file: testFile, name, line: source.slice(0, index).split('\n').length };
    };
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
          ...modules
            .filter(
              (other) =>
                other.scenarioId !== m.scenarioId &&
                (['0131', '0132'].some((suffix) => m.scenarioId.endsWith(suffix)) ||
                  other.scenarioId.endsWith('0138') ||
                  other.scenarioId.endsWith('0139')),
            )
            .map((other) => reference(other.name)),
        ],
      })),
    };
    validateBindings(ledger, plan);
    write('plan.json', plan);
    process.env.P0_BOOTSTRAP_FROZEN = frozen;
    process.env.P0_BOOTSTRAP_PROOF_DIR = output;
    const tests = [
      testFile,
      'packages/agent/tests/protocol-compat.test.cjs',
      'packages/agent/tests/process.test.cjs',
      'packages/agent/tests/state-cli.test.cjs',
      'packages/agent/tests/task-journal.test.cjs',
      'packages/agent/tests/events.test.cjs',
      'packages/agent/tests/ui-host.test.cjs',
      'packages/agent-client/tests/client.test.cjs',
      'packages/agent-client/tests/stdio.test.cjs',
      'scripts/agent/p0-test-receipts.test.mjs',
    ];
    const events = [],
      startedAt = new Date().toISOString();
    write('test-execution.json', {
      executable: process.execPath,
      api: 'node:test.run',
      files: tests,
      cwd: root,
      concurrency: 2,
      timeout: 120000,
      execArgv: process.execArgv,
      environmentOverrides: { P0_BOOTSTRAP_FROZEN: frozen, P0_BOOTSTRAP_PROOF_DIR: output },
      startedAt,
    });
    for await (const event of run({
      files: tests.map((f) => path.join(root, f)),
      concurrency: 2,
      timeout: 120000,
    }))
      events.push(event);
    delete process.env.P0_BOOTSTRAP_FROZEN;
    delete process.env.P0_BOOTSTRAP_PROOF_DIR;
    write('test-events.json', events);
    const summary = events.findLast((e) => e.type === 'test:summary' && !e.data.file)?.data;
    write('test-summary.json', summary ?? {});
    if (
      !summary?.success ||
      summary.counts.failed ||
      summary.counts.cancelled ||
      summary.counts.skipped ||
      summary.counts.todo ||
      events.some((e) => e.type === 'test:fail')
    )
      throw Error('Test batch failed; no receipts');
    for (const name of [
      ...lifecycleTests,
      'P0 bootstrap whole startup files are inventoried without issuing complete replacement passes',
    ]) {
      const ref = reference(name);
      const matches = events.filter(
        (e) =>
          e.type === 'test:pass' &&
          e.data.name === name &&
          e.data.file === path.join(root, ref.file) &&
          e.data.line === ref.line &&
          !e.data.skip &&
          !e.data.todo,
      );
      if (matches.length !== 1) throw Error('Missing exact lifecycle/inventory assertion: ' + name);
    }
    for (const [f, h] of Object.entries({ ...inputs, ...built }))
      if (hash(fs.readFileSync(path.join(root, f))) !== h) throw Error('Source/build drift: ' + f);
    if (git('rev-parse', 'HEAD').trim() !== sha) throw Error('HEAD drift');
    const preservation = read(batch + '/preservation-before.json'),
      changed = [],
      missing = [];
    for (const [f, h] of Object.entries(preservation.files)) {
      if (!fs.existsSync(path.join(root, f))) missing.push(f);
      else if (hash(fs.readFileSync(path.join(root, f))) !== h) changed.push(f);
    }
    if (missing.length || changed.some((f) => f !== implementation[0]))
      throw Error('Unexpected preexisting changes: ' + json({ changed, missing }));
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
        'bootstrap-inventory',
        'test-execution',
        'regression-source-check',
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
    if (done.size !== 4 || [...done].some((id) => !scope.entries.some((e) => e.id === id)))
      throw Error('Receipt scope mismatch');
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
      selected: 7,
      passed: 4,
      unresolved: 3,
      releaseEligible: false,
      results: scope.entries.map((e) => ({
        ...e,
        status: done.has(e.id) ? 'current-scoped-assertion' : 'unresolved-startup-responsibility',
        reason: unresolved.find((u) => u.scenarioId === e.scenarioId)?.reason,
        assertions: runs.filter((r) => r.entries.includes(e.id)),
      })),
    });
    const remaining = previous.entries.filter((e) => !done.has(e.id));
    write('remaining-entries.json', {
      sourceFingerprint,
      count: remaining.length,
      releaseEligible: false,
      byAssignment: Object.fromEntries(
        [...new Set(remaining.map((e) => e.assignment))]
          .sort()
          .map((a) => [a, remaining.filter((e) => e.assignment === a).length]),
      ),
      entries: remaining,
    });
    write('missing-progress.json', {
      baseline: ledger.sha,
      sourceFingerprint,
      releaseEligible: false,
      summary: {
        previousMissing: 652,
        newlyAssertedAmongPreviousMissing: 4,
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
      selected: 7,
      passed: 4,
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
    delete process.env.P0_BOOTSTRAP_FROZEN;
    delete process.env.P0_BOOTSTRAP_PROOF_DIR;
    fs.rmSync(frozen, { recursive: true, force: true });
  }
}
await main();
