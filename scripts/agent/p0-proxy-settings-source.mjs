// Local working-tree evidence; this does not relax or invoke hosted-only gates.
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
import { readPolicy } from './acceptance-policy.mjs';
import {
  batch,
  prior,
  testFile,
  implementation,
  names,
  modules,
  blockedScenarios,
  testFiles,
  limitations,
  requiredCompanionNames,
} from './p0-proxy-settings-source-plan.mjs';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const json = (v) =>
  JSON.stringify(
    v,
    (_k, x) =>
      x instanceof Error
        ? { name: x.name, message: x.message, stack: x.stack, errors: x.errors }
        : x,
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
  ...testFiles,
  'packages/agent/tests/settings-fixture.cjs',
  'packages/agent/tests/collaboration-provider.cjs',
  ...implementation,
  testFile,
  'scripts/agent/p0-proxy-settings-source.mjs',
  'scripts/agent/p0-proxy-settings-source-plan.mjs',
  'apps/web/tests/resolve-ts.mjs',
  'packages/ui/tests/resolve-ts.mjs',
];
const frozenFiles = ['apps/server/src/proxy/proxy-settings.ts'];

async function main() {
  const [destination, ...extra] = process.argv.slice(2),
    output = destination && path.resolve(destination);
  if (!output || extra.length || !output.startsWith(root + path.sep) || fs.existsSync(output))
    throw Error('Expected fresh workspace replay directory');
  fs.mkdirSync(path.join(output, 'logs'), { recursive: true });
  const write = (f, value) => fs.writeFileSync(path.join(output, f), json(value), { flag: 'wx' });
  const previous = read(prior + '/remaining-entries.json'),
    scope = read(batch + '/scope.json'),
    ledger = read('docs/acceptance/issue-257-258/8f30e6b/ledger.json');
  validateLedger(ledger);
  if (
    previous.count !== 577 ||
    previous.entries.length !== 577 ||
    new Set(previous.entries.map((e) => e.id)).size !== 577 ||
    scope.previous !== prior + '/remaining-entries.json' ||
    scope.selected !== 1 ||
    scope.entries.length !== 1 ||
    modules.length !== 1 ||
    new Set(modules.map((m) => m.scenarioId)).size !== 1 ||
    hash(fs.readFileSync(path.join(root, scope.previous))) !== scope.previousSha256 ||
    json(scope.entries) !==
      json(
        previous.entries.filter(
          (e) =>
            modules.some((m) => m.scenarioId === e.scenarioId) ||
            blockedScenarios.includes(e.scenarioId),
        ),
      )
  )
    throw Error('Original scope/remainder changed');
  const exact = (id) => {
    const matches = previous.entries.filter((e) => e.scenarioId === id);
    if (matches.length !== 1) throw Error('Ambiguous original ID: ' + id);
    return matches[0];
  };
  const sha = git('rev-parse', 'HEAD').trim(),
    target = process.platform + '-' + process.arch;
  const policy = readPolicy(path.join(root, 'scripts/agent/acceptance-mac-arm64.json'));
  if (
    target !== 'darwin-arm64' ||
    policy.id !== 'mac-arm64-local-2026-11-08' ||
    !policy.localProofs ||
    json(policy.requiredTargets) !== json([target])
  )
    throw Error('Only reviewed local Mac policy supported');
  const require = createRequire(path.join(root, 'packages/agent/package.json')),
    Database = require('better-sqlite3'),
    db = new Database(':memory:');
  db.close();
  const native = Object.keys(require.cache)
    .filter((f) => f.endsWith('.node'))
    .map((f) => path.relative(root, f));
  if (native.length !== 1 || !native[0].includes('better-sqlite3/'))
    throw Error('Unexpected native input');
  const inputs = digest([
      ...[
        'packages/domain/src',
        'packages/domain/tests',
        'packages/protocol/src',
        'packages/protocol/tests',
        'packages/agent/src',
        'packages/agent/tests',
        'packages/agent-client/src',
        'packages/agent-client/tests',
        'apps/desktop/src',
        'apps/desktop/test',
        'apps/desktop/scripts',
        'apps/web/src',
        'apps/web/tests',
        'scripts/agent',
      ].flatMap(walk),
      ...changes,
      ...native,
      ...git('ls-files', '*package.json', '*tsconfig*.json', 'package-lock.json')
        .trim()
        .split('\n')
        .filter(Boolean),
    ]),
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
  for (const f of new Set(changes)) {
    const to = path.join(output, 'source-snapshot', f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
  }
  fs.writeFileSync(path.join(output, 'working-tree.patch'), git('diff', '--', ...changes));
  const historicalFiles = [
    prior + '/remaining-entries.json',
    prior + '/receipts.json',
    prior + '/batch-proof.json',
    prior + '/missing-progress.json',
    'scripts/agent/acceptance-mac-arm64.json',
    batch + '/scope.json',
    batch + '/preservation-before.json',
    batch + '/reviewed-guidance.json',
    batch + '/verify-integrity.mjs',
    batch + '/prior-integrity-check.json',
    batch + '/scope-blockers.json',
  ];
  write('historical-inputs.json', digest(historicalFiles));
  const previousProof = read(prior + '/batch-proof.json');
  for (const attachment of [...previousProof.attachments, previousProof.events])
    if (hash(fs.readFileSync(path.join(root, prior, attachment.path))) !== attachment.sha256)
      throw Error('Prior attachment changed: ' + attachment.path);
  const previousRuns = read(prior + '/receipts.json').runs;
  if (new Set(previousRuns.flatMap((r) => r.entries)).size !== 3)
    throw Error('Prior receipt count mismatch');
  write('prior-review.json', {
    actualPriorNewIds: 3,
    currentRemainder: 577,
    priorAttachmentsVerified: previousProof.attachments.length,
    note: 'Previous batch 26 formal replay-01 exact three receipts and 577 remaining IDs verified; all previous attachments preserved. Prior scoped evidence is not merged for release.',
  });
  const commands = [];
  function command(name, args, { independent = false, expectedExit = 0, env = {} } = {}) {
    const log = 'logs/' + name + '.log',
      fd = fs.openSync(path.join(output, log), 'wx'),
      startedAt = new Date().toISOString();
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
  const frozen = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch27-frozen-'));
  try {
    const archive = execFileSync('git', ['archive', ledger.sha, ...frozenFiles], {
      cwd: root,
      maxBuffer: 32 << 20,
    });
    execFileSync('tar', ['-xf', '-', '-C', frozen], { input: archive });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(frozen, 'node_modules'), 'dir');
    const frozenHashes = {};
    for (const f of frozenFiles) {
      const bytes = fs.readFileSync(path.join(frozen, f));
      frozenHashes[f] = hash(bytes);
      if (hash(execFileSync('git', ['show', ledger.sha + ':' + f], { cwd: root })) !== hash(bytes))
        throw Error('Frozen Git object mismatch');
      const to = path.join(output, 'frozen-snapshot', f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, bytes);
    }
    write('frozen-inputs.json', {
      baseline: ledger.sha,
      archiveSha256: hash(archive),
      files: frozenHashes,
    });
    const asts = testFiles.map((file) => ({
      file,
      ast: ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      ),
    }));
    const reference = (name) => {
      const matches = asts.flatMap(({ file, ast }) =>
        ast.statements
          .filter(
            (s) =>
              ts.isExpressionStatement(s) &&
              ts.isCallExpression(s.expression) &&
              s.expression.expression.getText(ast) === 'test' &&
              ts.isStringLiteral(s.expression.arguments[0]) &&
              s.expression.arguments[0].text === name,
          )
          .map((s) => ({
            file,
            name,
            line: ast.getLineAndCharacterOfPosition(s.getStart(ast)).line + 1,
          })),
      );
      if (matches.length !== 1) throw Error('Missing/ambiguous test anchor: ' + name);
      return matches[0];
    };
    const reviewedFiles = [
      ...new Set(
        [...modules.flatMap((m) => m.tests), ...requiredCompanionNames].map(
          (n) => reference(n).file,
        ),
      ),
    ];
    const plan = {
      schemaVersion: 1,
      nodeImports: ['apps/web/tests/resolve-ts.mjs'],
      sha,
      sourceFingerprint,
      reviewedTooling: Object.fromEntries(reviewedFiles.map((f) => [f, inputs[f]])),
      bindings: modules.map((m) => ({
        entries: [exact(m.scenarioId).id],
        implementation,
        limitations,
        assertion: m.assertion,
        tests: [...m.tests, ...requiredCompanionNames].map(reference),
      })),
    };
    validateBindings(ledger, plan);
    write('plan.json', plan);
    const inventory = frozenFiles.map((f) => {
      const ast = ts.createSourceFile(
        f,
        fs.readFileSync(path.join(frozen, f), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      return {
        file: f,
        declarations: ast.statements
          .filter((s) => !ts.isImportDeclaration(s))
          .map((s) => ({
            kind: ts.SyntaxKind[s.kind],
            name: s.name?.text,
            members: s.members
              ?.filter((m) => ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m))
              .map((m) => m.name?.getText(ast) ?? 'constructor'),
          })),
      };
    });
    write('responsibility-inventory.json', {
      frozen: inventory,
      assertionMap: modules,
      limitations,
      note: 'Inventory identifies responsibilities; passing associations are based on exact executed assertions, never inventory presence.',
    });
    const env = {
      P0_PROXY_SETTINGS_SOURCE_FROZEN: frozen,
      P0_PROXY_SETTINGS_SOURCE_PROOF_DIR: output,
    };
    Object.assign(process.env, env);
    const events = [],
      startedAt = new Date().toISOString();
    write('test-execution.json', {
      executable: process.execPath,
      api: 'node:test.run',
      files: testFiles,
      cwd: root,
      concurrency: 2,
      timeout: 120000,
      execArgv: ['--import', path.join(root, 'apps/web/tests/resolve-ts.mjs')],
      environmentOverrides: env,
      startedAt,
    });
    for await (const event of run({
      files: testFiles.map((f) => path.join(root, f)),
      execArgv: ['--import', path.join(root, 'apps/web/tests/resolve-ts.mjs')],
      concurrency: 2,
      timeout: 120000,
    }))
      events.push(event);
    for (const key of Object.keys(env)) delete process.env[key];
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
    for (const name of [...Object.values(names), ...requiredCompanionNames]) {
      const ref = reference(name);
      if (
        events.filter(
          (e) =>
            e.type === 'test:pass' &&
            e.data.name === name &&
            e.data.file === path.join(root, ref.file) &&
            e.data.line === ref.line &&
            !e.data.skip &&
            !e.data.todo,
        ).length !== 1
      )
        throw Error('Missing exact required assertion: ' + name);
    }
    for (const [f, h] of Object.entries({
      ...inputs,
      ...built,
      ...read(path.relative(root, path.join(output, 'historical-inputs.json'))),
    }))
      if (hash(fs.readFileSync(path.join(root, f))) !== h) throw Error('Input drift: ' + f);
    if (git('rev-parse', 'HEAD').trim() !== sha) throw Error('HEAD drift');
    const preservation = read(batch + '/preservation-before.json'),
      changed = [],
      missing = [];
    for (const [f, h] of Object.entries(preservation.files)) {
      if (!fs.existsSync(path.join(root, f))) missing.push(f);
      else if (hash(fs.readFileSync(path.join(root, f))) !== h) changed.push(f);
    }
    if (missing.length || changed.length)
      throw Error('Unexpected preexisting change: ' + json({ changed, missing }));
    write('preservation-check.json', {
      before: Object.keys(preservation.files).length,
      changed,
      expectedChanges: [],
      unexpectedChanges: [],
      missing,
      unchanged: Object.keys(preservation.files).length,
    });
    const attachmentNames = [
      'source-state.json',
      'built-inputs.json',
      'frozen-inputs.json',
      'historical-inputs.json',
      'plan.json',
      'prior-review.json',
      'responsibility-inventory.json',
      'test-execution.json',
      'test-summary.json',
      'preservation-check.json',
      'commands.json',
      'working-tree.patch',
      ...fs
        .readdirSync(output)
        .filter(
          (f) =>
            f.endsWith('.json') &&
            ![
              'test-events.json',
              'built-inputs.json',
              'source-state.json',
              'frozen-inputs.json',
              'historical-inputs.json',
              'plan.json',
              'prior-review.json',
              'responsibility-inventory.json',
              'test-execution.json',
              'test-summary.json',
              'preservation-check.json',
              'commands.json',
            ].includes(f),
        ),
      ...[...new Set(changes)].map((f) => 'source-snapshot/' + f),
      ...frozenFiles.map((f) => 'frozen-snapshot/' + f),
      ...commands.map((c) => c.log.path),
    ];
    const proof = {
      policy: policy.id,
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
      attachments: attachmentNames.map((f) => ({
        path: f,
        sha256: hash(fs.readFileSync(path.join(output, f))),
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
      })),
      done = new Set(runs.flatMap((r) => r.entries));
    if (
      done.size !== 1 ||
      [...done].some((id) => !modules.some((m) => exact(m.scenarioId).id === id))
    )
      throw Error('Exact receipt scope mismatch');
    write('receipts.json', {
      stage: 'after-retirement',
      policy: policy.id,
      baseline: ledger.sha,
      sha,
      sourceKind: 'working-tree',
      sourceFingerprint,
      releaseEligible: false,
      runs,
    });
    write('scope-results.json', {
      selected: 1,
      passed: 1,
      unresolved: 0,
      releaseEligible: false,
      results: scope.entries.map((e) => ({
        ...e,
        status: done.has(e.id)
          ? 'current-scoped-assertion'
          : 'blocked-needs-real-client-interaction',
        blocker: done.has(e.id)
          ? undefined
          : read(batch + '/scope-blockers.json').find((b) => b.scenarioId === e.scenarioId),
        assertions: runs.filter((r) => r.entries.includes(e.id)),
      })),
    });
    const remaining = previous.entries.filter((e) => !done.has(e.id));
    if (remaining.length !== 576) throw Error('Remainder set mismatch');
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
        previousMissing: 577,
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
    const independentGateFailures = commands.filter(
      (c) => c.independent && c.exitCode !== c.expectedExit,
    );
    const result = {
      selected: 1,
      passed: 1,
      unresolved: 0,
      remaining: remaining.length,
      tests: summary.counts,
      sourceFingerprint,
      proofSha256: proofRef.sha256,
      independentGateFailures,
      scopeBlockers: read(batch + '/scope-blockers.json'),
      releaseEligible: false,
    };
    write('summary.json', result);
    console.log(json(result));
    if (independentGateFailures.length) process.exitCode = 1;
  } finally {
    for (const key of ['P0_PROXY_SETTINGS_SOURCE_FROZEN', 'P0_PROXY_SETTINGS_SOURCE_PROOF_DIR'])
      delete process.env[key];
    fs.rmSync(frozen, { recursive: true, force: true });
  }
}
try {
  await main();
} catch (error) {
  const destination = process.argv[2];
  if (destination && fs.existsSync(path.resolve(destination)))
    fs.writeFileSync(
      path.resolve(destination, 'failure.json'),
      json({ message: error.message, stack: error.stack }),
      { flag: 'wx' },
    );
  throw error;
}
