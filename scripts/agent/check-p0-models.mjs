// Frozen shared contract parity; compile-time checks are not I/O acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { readPolicy } from './acceptance-policy.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Assignability alone treats `any` as compatible with everything. Record its
// positions in user contracts so a new any cannot erase a field/signature rule.
function anyPositions(checker, initial) {
  const found = new Set(), ancestors = new Set();
  function visit(type, key, depth = 0) {
    if (type.flags & ts.TypeFlags.Any) { found.add(key); return; }
    if (ancestors.has(type)) return;
    if (depth > 48) throw Error('Contract type graph exceeds review depth');
    ancestors.add(type);
    const descend = (next, part) => visit(next, key + part, depth + 1);
    if (type.isUnionOrIntersection()) type.types.forEach((part, index) => descend(part, '.union' + index));
    else if (checker.isArrayType(type) || checker.isTupleType(type))
      checker.getTypeArguments(type).forEach((part, index) => descend(part, '.item' + index));
    else if ((type.flags & ts.TypeFlags.Object) &&
        !type.symbol?.declarations?.every((node) => /[\\/]typescript[\\/]lib[\\/]lib\..*\.d\.ts$/.test(node.getSourceFile().fileName))) {
      for (const property of checker.getPropertiesOfType(type)) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (declaration) descend(checker.getTypeOfSymbolAtLocation(property, declaration), '.property:' + property.name);
      }
      for (const [index, signature] of checker.getSignaturesOfType(type, ts.SignatureKind.Call).entries()) {
        signature.parameters.forEach((parameter, n) => {
          const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
          if (declaration) descend(checker.getTypeOfSymbolAtLocation(parameter, declaration), '.call' + index + '.arg' + n);
        });
        descend(checker.getReturnTypeOfSignature(signature), '.call' + index + '.return');
      }
      checker.getIndexInfosOfType(type).forEach((info, index) => descend(info.type, '.index' + index));
    }
    ancestors.delete(type);
  }
  visit(initial, '$');
  return found;
}

function compatibleTypes(checker, previous, next) {
  if (!checker.isTypeAssignableTo(previous, next) || !checker.isTypeAssignableTo(next, previous)) return false;
  const oldAny = anyPositions(checker, previous);
  return [...anyPositions(checker, next)].every((position) => oldAny.has(position));
}

export function compareContracts(old, targets, directory, baselineRoot, selectedNames, additionalRoots = []) {
  if (selectedNames && (!Array.isArray(selectedNames) || !selectedNames.length ||
      new Set(selectedNames).size !== selectedNames.length)) throw Error('Invalid selected contract names');
  const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true,
    paths: Object.fromEntries(targets.map(([name, file]) => ['@alune/' + name, [file]])) };
  const program = ts.createProgram([old, ...targets.map((target) => target[1]), ...additionalRoots], options);
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw Error(ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => directory, getNewLine: () => '\n', getCanonicalFileName: (name) => name,
  }));
  const unalias = (symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const symbols = (file) => new Map(checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)))
    .map((symbol) => [symbol.name, unalias(symbol)]));
  const candidates = targets.map(([name, file]) => [name, symbols(file)]);
  const rows = [];
  for (const [name, previous] of symbols(old)) {
    if (selectedNames && !selectedNames.includes(name)) continue;
    const owners = candidates.filter(([, exports]) => exports.has(name));
    const row = { name, file: path.relative(baselineRoot, previous.declarations[0].getSourceFile().fileName)
      .split(path.sep).join('/'), owner: owners[0]?.[0], checks: [],
      valueExport: Boolean(previous.flags & ts.SymbolFlags.Value), compatible: owners.length === 1 };
    if (owners.length === 1) {
      const next = owners[0][1].get(name);
      const equal = (left, right) => compatibleTypes(checker, left, right);
      if (previous.flags & ts.SymbolFlags.Type) {
        const params = previous.declarations.find((declaration) => declaration.typeParameters?.length)?.typeParameters;
        let ok;
        if (params) {
          const minimum = params.findIndex((param) => param.default);
          const arities = Array.from({ length: params.length - (minimum < 0 ? params.length : minimum) + 1 },
            (_, index) => (minimum < 0 ? params.length : minimum) + index);
          ok = Boolean(next.flags & ts.SymbolFlags.Type);
          for (const arity of arities) {
            const provided = params.slice(0, arity), generics = provided.map((param) => param.getText()).join(',');
            const args = provided.map((param) => param.name.text).join(',');
            const prefix = arity ? `<${generics}>` : '', use = arity ? `<${args}>` : '';
            const file = path.join(directory, 'compare-' + name + '-' + arity + '.ts');
            fs.writeFileSync(file, `import type * as Old from '${old.replaceAll('\\', '/')}';
import type * as New from '@alune/${row.owner}';
type OldType=${prefix}()=>Old.${name}${use};type NewType=${prefix}()=>New.${name}${use};
declare const old:OldType;declare const next:NewType;
const forward:NewType=old;const reverse:OldType=next;`);
            const genericProgram = ts.createProgram([file, ...additionalRoots], options);
            if (ts.getPreEmitDiagnostics(genericProgram).length) { ok = false; continue; }
            const genericChecker = genericProgram.getTypeChecker();
            const aliases = genericProgram.getSourceFile(file).statements.filter(ts.isTypeAliasDeclaration);
            const types = aliases.map((alias) => genericChecker.getTypeAtLocation(alias));
            ok &&= compatibleTypes(genericChecker, types[0], types[1]);
          }
        } else ok = Boolean(next.flags & ts.SymbolFlags.Type) &&
          equal(checker.getDeclaredTypeOfSymbol(previous), checker.getDeclaredTypeOfSymbol(next));
        row.checks.push({ check: params ? 'generic type signature, both directions' : 'type, both directions', ok });
        row.compatible &&= ok;
      }
      if (row.valueExport) {
        const value = (symbol) => checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? symbol.declarations[0]);
        const ok = Boolean(next.flags & ts.SymbolFlags.Value) && equal(value(previous), value(next));
        row.checks.push({ check: 'value signature, both directions', ok });
        row.compatible &&= ok;
      }
    }
    rows.push(row);
  }
  if (selectedNames && rows.length !== selectedNames.length) throw Error('Missing selected frozen contract');
  return rows;
}

function runtimeSamples(oldValues) {
  const patch = '@@ -1,2 +1,2 @@\n same\n-before\n+after\n@@ -9 +11 @@\n-旧\n+新';
  const marker = 'before\n<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> topic\nafter\n';
  const blocks = oldValues.conflictBlocks(marker);
  const commits = ['a', 'b'].map((hash) => ({ hash, message: hash, author: 'dev', published: false }));
  const patches = ['', patch, 'Binary files a and b differ', patch.replaceAll('\n', '\r\n'), '@@ malformed @@\n+bad', '@@ -1,0 +1,1 @@\n+😀'];
  const files = [...['added', 'deleted', 'modified', 'untracked'].flatMap((status) => [false, true]
    .flatMap((staged) => [undefined, 'submodule', 'directory', 'worktree', 'repository'].map((kind) => ({
      path: 'a', status, staged, kind, repositoryPath: kind ? 'a' : undefined, submodule: { commitChanged: true },
    })))), { path: 'unsafe\n/', status: 'untracked', staged: false }, { path: 'x', status: 'modified', staged: false, conflicted: true }];
  const conflicts = [marker, marker.replaceAll('\n', '\r\n'), '', marker.slice(0, 22), marker + marker];
  return {
    diffImageMediaType: ['a.PNG', 'weird.x', 'a.jpg', 'x.svg', '无扩展', '.gif'].map((value) => [value]),
    terminalNeedsConfirmation: ['connecting', 'running', 'failed', 'exited', 'disconnected'].map((state) => [{ state }]),
    changeActions: files.map((file) => [file]), changeKindLabel: files.map((file) => [file]),
    parsePatchHunks: patches.map((value) => [value]), pullRequestDiffLines: patches.map((value) => [value]),
    pullRequestRange: ['LEFT', 'RIGHT', 'unknown'].flatMap((side) => [[1, 1], [1, 2], [2, 11], [0, 1], [9, 9]]
      .map(([startLine, endLine]) => [patch, { side, startLine, endLine }])),
    parseConflictMarkers: conflicts.map((value) => [value]), conflictBlocks: conflicts.map((value) => [value]),
    resolveConflictBlock: ['current', 'incoming', 'both'].flatMap((choice) => [
      [marker, blocks[0].index, choice, blocks[0].raw], [marker, 0, choice, 'stale'],
    ]),
    previewRebasePlan: ['pick', 'drop', 'squash', 'fixup', 'reword', 'bad'].map((action) => [commits, [
      { hash: 'a', action: 'pick' }, { hash: 'b', action, message: 'changed' },
    ]]),
    parseLfsPointer: ['', 'binary', 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'f'.repeat(64) + '\nsize 42\n',
      'version https://git-lfs.github.com/spec/v1\noid sha256:bad\nsize 1', 'x'.repeat(1025)].map((value) => [value]),
  };
}

export function compareRuntime(rows, oldValues, owners, samples) {
  const outcome = (fn, args) => {
    try { return { result: fn(...structuredClone(args)) }; }
    catch (error) { return { error: error.constructor.name, message: error.message }; }
  };
  for (const row of rows.filter((row) => row.valueExport)) {
    assert.ok(row.compatible, row.name + ': signature mismatch');
    const old = oldValues[row.name], next = owners[row.owner][row.name];
    if (row.name === 'ConflictMarkerError') {
      assert.equal(new old('example').message, new next('example').message);
      assert.ok(new next() instanceof Error);
      row.runtimeSamples = 1;
    } else if (typeof old !== 'function') {
      assert.deepEqual(next, old, row.name);
      row.runtimeSamples = 1;
    } else {
      assert.ok(samples[row.name]?.length, row.name + ' needs runtime scenarios');
      for (const args of samples[row.name]) assert.deepEqual(outcome(next, args), outcome(old, args), row.name);
      row.runtimeSamples = samples[row.name].length;
    }
  }
}

export function modelRuns(ledger, rows, sha, target, proof) {
  const exports = ledger.entries.filter((entry) => entry.kind === 'export' && entry.file.startsWith('packages/shared/'));
  const indexed = new Map(rows.map((row) => [row.file + ':' + row.name, row]));
  if (indexed.size !== rows.length || exports.length !== rows.length)
    throw Error('Expected every frozen shared export exactly once');
  return exports.map((entry) => {
    const row = indexed.get(entry.file + ':' + entry.name);
    if (!row) throw Error('Missing frozen model export row: ' + entry.id);
    if (row.compatible && (!row.checks.length || row.checks.some((check) => !check.ok) ||
        (row.valueExport && !row.runtimeSamples))) throw Error('Unverified model export: ' + entry.id);
    return { sha, target, result: row.compatible ? 'passed' : 'failed', entries: [entry.id], proof,
      scenario: 'P0 model contract: ' + entry.file + ':' + entry.name,
      assertion: row.compatible ? row.checks.map((check) => check.check).join('; ') +
        (row.runtimeSamples ? '; ' + row.runtimeSamples + ' runtime value/result/error samples equal' : '; compile-time declaration only')
        : 'Frozen export is missing, ambiguous or incompatible; successor event contract needs explicit parity review',
      limitations: 'Contract/signature and declared samples only; not I/O effects, branch coverage, native Git/LFS or UI acceptance.' };
  });
}

export async function runCLI(args) {
  const [ledgerFile, previousFile, output, policyFile] = args;
  if (!policyFile) throw Error('Usage: check-p0-models.mjs LEDGER PREVIOUS_RECEIPTS NEW_OUTPUT_DIRECTORY POLICY');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const ledger = readJSON(ledgerFile), previous = readJSON(previousFile), policy = readPolicy(policyFile);
  validateLedger(ledger);
  const target = process.platform + '-' + process.arch;
  if (!policy.localProofs || !policy.requiredTargets.includes(target)) throw Error('Unsupported local acceptance target');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const sha = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain=v1', '--', 'packages/domain', 'packages/protocol'))
    throw Error('Model source must match the recorded HEAD');
  const directory = path.resolve(output);
  fs.mkdirSync(directory, { recursive: false });
  const temporary = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'alune-p0-models-'));
  try {
    const archive = execFileSync('git', ['archive', ledger.sha, 'packages/shared/src'], { cwd: root });
    execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
    const old = path.join(temporary, 'packages/shared/src/index.ts');
    const targets = ['domain', 'protocol'].map((name) => [name, path.join(root, 'packages', name, 'src/index.ts')]);
    const rows = compareContracts(old, targets, temporary, temporary);
    const archiveProgram = ts.createProgram([old], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, skipLibCheck: true,
      outDir: path.join(temporary, 'dist'), rootDir: path.dirname(old) });
    assert.equal(archiveProgram.emit().emitSkipped, false);
    // Force current runtime output; never use a previous branch's dist as evidence.
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-b',
      'packages/domain', 'packages/protocol', '--force'], { cwd: root, stdio: 'pipe' });
    const req = createRequire(path.join(root, 'package.json'));
    const oldValues = req(path.join(temporary, 'dist/index.js'));
    compareRuntime(rows.filter((row) => row.compatible), oldValues,
      { domain: req('@alune/domain'), protocol: req('@alune/protocol') }, runtimeSamples(oldValues));
    if (git('rev-parse', 'HEAD') !== sha || git('status', '--porcelain=v1', '--', 'packages/domain', 'packages/protocol'))
      throw Error('Model source changed during replay');
    const inputs = Object.fromEntries(git('ls-files', 'packages/domain/src', 'packages/protocol/src').split('\n')
      .filter(Boolean).map((file) => [file, digest(fs.readFileSync(path.join(root, file)))]));
    const result = { baseline: ledger.sha, sha, target, node: process.version,
      driverSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), inputs, rows };
    const bytes = JSON.stringify(result, null, 2) + '\n';
    fs.writeFileSync(path.join(directory, 'models.json'), bytes);
    const runs = modelRuns(ledger, rows, sha, target, { path: 'models.json', sha256: digest(bytes) });
    const receipts = { stage: 'after-retirement', policy: policy.id, sha, baseline: ledger.sha, runs };
    fs.writeFileSync(path.join(directory, 'receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
    const progress = missingProgress(ledger, previous, receipts);
    fs.writeFileSync(path.join(directory, 'missing-progress.json'), JSON.stringify(progress, null, 2) + '\n');
    console.log(JSON.stringify({ exports: rows.length, compatible: rows.filter((row) => row.compatible).length,
      runtimeExports: rows.filter((row) => row.valueExport).length,
      runtimeSamples: rows.reduce((sum, row) => sum + (row.runtimeSamples || 0), 0),
      failed: rows.filter((row) => !row.compatible).map((row) => row.name) }));
    if (rows.some((row) => !row.compatible)) process.exitCode = 1;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runCLI(process.argv.slice(2));
