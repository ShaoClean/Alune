// Explicit type-only contracts. No runtime export or source-module association.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compareContracts } from './check-p0-models.mjs';
import { validateLedger, missingProgress } from './p0-test-receipts.mjs';
import { readPolicy } from './acceptance-policy.mjs';
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const selectedTypes = [
  ['components/commit-graph', ['GraphEdge', 'GraphRow', 'GraphLayout']],
  ['components/find-in-content', ['FindOptions', 'FindMatch', 'FindPattern']],
  ['stores/workspaceLayout', ['LayoutPreferences']],
  ['stores/terminalState', ['ViewSession']],
  ['components/files-git-status', ['FileDecorationStatus']],
  ['components/conflict-model', ['WholeFileAction', 'ContextExcerpt']],
  ['components/files-tree', ['DirectoryState', 'TreeRow']],
  ['components/diff-lines', ['DiffLine', 'NumberedDiffLine', 'ImageDiffKind']],
  ['stores/sidebarOrder', ['TreeItem', 'Placement']],
  ['components/history-filter', ['Draft']],
];
export async function main(args) {
  const [ledgerFile, previousFile, output, policyFile] = args;
  if (!policyFile) throw Error('Usage: p0-web-types.mjs LEDGER PREVIOUS NEW_OUTPUT_DIRECTORY POLICY');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile)), previous = JSON.parse(fs.readFileSync(previousFile));
  validateLedger(ledger);
  const policy = readPolicy(policyFile), target = process.platform + '-' + process.arch;
  if (!policy.localProofs || !policy.requiredTargets.includes(target)) throw Error('Unsupported local proof policy');
  const git = (...params) => execFileSync('git', params, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
  if (git('rev-parse', 'HEAD') !== sha) throw Error('Type contracts require review at the actual HEAD');
  const files = git('ls-files', 'apps/web/src', 'packages/domain/src', 'packages/protocol/src').split('\n').filter(Boolean);
  const inputs = {};
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file));
    const committed = execFileSync('git', ['show', sha + ':' + file], { cwd: root });
    if (!bytes.equals(committed)) throw Error('Business source differs from reviewed HEAD: ' + file);
    inputs[file] = hash(bytes);
  }
  const ids = new Set(ledger.entries.map((entry) => entry.id));
  const plan = selectedTypes.flatMap(([module, names]) => names.map((name) => ({
    file: `apps/web/src/${module}.ts`, name, id: `export:apps/web/src/${module}.ts:${name}`,
  })));
  if (plan.length !== 19 || new Set(plan.map((row) => row.id)).size !== 19 || plan.some((row) => !ids.has(row.id)))
    throw Error('Invalid explicit type-only P0 bindings');
  fs.mkdirSync(output, { recursive: false });
  const temporary = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'p0-web-type-baseline-'));
  try {
    const archive = execFileSync('git', ['archive', ledger.sha, 'packages/shared/src', 'apps/web/src'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', temporary], { input: archive });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    const rows = [];
    for (const [module, names] of selectedTypes) {
      const relative = `apps/web/src/${module}.ts`;
      const targets = [
        ['candidate', path.join(root, relative)],
        ['domain', path.join(root, 'packages/domain/src/index.ts')],
        ['protocol', path.join(root, 'packages/protocol/src/index.ts')],
        ['shared', path.join(temporary, 'packages/shared/src/index.ts')],
      ];
      const compared = compareContracts(path.join(temporary, relative), targets, temporary, temporary, names);
      if (compared.length !== names.length || compared.some((row) => row.valueExport))
        throw Error('Only every explicitly reviewed type-only export may be certified');
      rows.push(...compared);
    }
    for (const [file, expected] of Object.entries(inputs))
      if (hash(fs.readFileSync(path.join(root, file))) !== expected) throw Error('Source changed during type comparison');
    if (git('rev-parse', 'HEAD') !== sha) throw Error('HEAD changed during type comparison');
    const proof = { sha, baseline: ledger.sha, target, compiler: ts.version, inputs, rows,
      driverSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
      comparatorSha256: hash(fs.readFileSync(new URL('./check-p0-models.mjs', import.meta.url))),
      limitations: 'Compile-time declarations only; no runtime samples, I/O effects, UI interaction or source-module acceptance.' };
    const bytes = JSON.stringify(proof, null, 2) + '\n';
    fs.writeFileSync(path.join(output, 'types.json'), bytes);
    const runs = rows.map((row) => ({ sha, target, entries: [`export:${row.file}:${row.name}`],
      scenario: 'P0 web type contract: ' + row.file + ':' + row.name,
      assertion: 'Both-direction type compatibility with the frozen declaration, generic defaults and no new any positions; compile-time declaration only.',
      limitations: proof.limitations, result: row.compatible ? 'passed' : 'failed',
      proof: { path: 'types.json', sha256: hash(bytes) } }));
    const receipts = { stage: 'after-retirement', policy: policy.id, sha, baseline: ledger.sha, runs };
    fs.writeFileSync(path.join(output, 'receipts.json'), JSON.stringify(receipts, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'missing-progress.json'), JSON.stringify(missingProgress(ledger, previous, receipts), null, 2) + '\n');
    console.log(JSON.stringify({ types: rows.length, compatible: rows.filter((row) => row.compatible).length,
      failed: rows.filter((row) => !row.compatible).map((row) => row.file + ':' + row.name) }));
    if (rows.some((row) => !row.compatible)) process.exitCode = 1;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
