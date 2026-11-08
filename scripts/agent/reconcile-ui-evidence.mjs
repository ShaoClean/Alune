// Reconcile individual P0 callbacks without turning static references, focused
// runs, or a failed replay into a release receipt. This report is NOT a gate.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const shaPattern = /^[0-9a-f]{40}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function assertionCandidates(root) {
  const candidates = [];
  const files = [...new Set(execFileSync('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', 'apps/desktop/src',
  ], { cwd: root, encoding: 'utf8' }).split('\0'))]
    .filter((file) => file.endsWith('.cjs') && fs.existsSync(path.join(root, file))).sort();
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file));
    const source = ts.createSourceFile(file, bytes.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'pass' &&
          node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) {
        const ui = node.arguments[0].elements.filter(ts.isStringLiteralLike).map((e) => e.text);
        if (ui.length) candidates.push({
          file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          sourceSha256: digest(bytes), ui,
          scenario: node.arguments[1]?.getText(source) ?? '',
          evidence: false,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return candidates;
}

export function loadNativeObservation(directory, expectedSha) {
  if (!shaPattern.test(expectedSha)) throw Error('Observation needs its actual source SHA');
  const records = [], artifacts = [];
  function read(name, required = false) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) {
      if (required) throw Error('Missing native artifact: ' + name);
      return undefined;
    }
    const bytes = fs.readFileSync(file);
    artifacts.push({ name, sha256: digest(bytes) });
    return bytes.toString();
  }
  const workbench = read('workbench.json');
  if (workbench !== undefined) {
    const rows = JSON.parse(workbench);
    if (!Array.isArray(rows)) throw Error('Expected workbench scenario array');
    records.push(...rows);
  }
  const phases = {};
  for (const phase of ['write', 'restore']) {
    const scenarios = read('scenarios-' + phase + '.jsonl');
    if (scenarios !== undefined)
      records.push(...scenarios.split('\n').filter((line) => line.trim()).map(JSON.parse));
    const marker = read('complete-' + phase + '.json');
    if (marker !== undefined) {
      phases[phase] = JSON.parse(marker);
      if (phases[phase].sha !== expectedSha || phases[phase].phase !== phase ||
          phases[phase].result !== 'passed' ||
          !(phases[phase].focus === null || typeof phases[phase].focus === 'string'))
        throw Error('Invalid native completion marker: ' + phase);
    }
  }
  if (!records.length) throw Error('Missing native scenario records');
  const complete = ['write', 'restore'].every((phase) =>
    phases[phase]?.focus === null && artifacts.some((a) => a.name === 'scenarios-' + phase + '.jsonl'));
  if (complete && ['write', 'restore'].some((phase) =>
    !fs.readFileSync(path.join(directory, 'scenarios-' + phase + '.jsonl'), 'utf8').trim()))
    throw Error('Empty native scenario phase');
  const stateText = read('source-state.json');
  let sourceState;
  if (stateText !== undefined) {
    sourceState = JSON.parse(stateText);
    if (sourceState.head !== expectedSha || typeof sourceState.dirty !== 'boolean')
      throw Error('Invalid native source provenance');
    for (const input of sourceState.files ?? []) {
      if (!input.copy) continue; // Earlier snapshots only declared hashes.
      const resolved = path.resolve(directory, input.copy);
      if (!resolved.startsWith(path.resolve(directory) + path.sep) ||
          !/^[0-9a-f]{64}$/.test(input.sha256 ?? '') || digest(read(input.copy, true)) !== input.sha256)
        throw Error('Invalid native source copy');
    }
    if (sourceState.patch) {
      const { name, sha256 } = sourceState.patch;
      if (typeof name !== 'string' || path.basename(name) !== name ||
          !/^[0-9a-f]{64}$/.test(sha256 ?? '') || digest(read(name, true)) !== sha256)
        throw Error('Invalid native source patch');
    }
  }
  return { sha: expectedSha, complete, phases, artifacts, records,
    provenance: sourceState ?? { dirty: null, note: 'Source/build provenance not captured by this run.' } };
}

export function reconcileUIEvidence({ ledger, baseline, observations = [], candidates = [], reviews = [], associations = [], currentSha }) {
  if (!shaPattern.test(currentSha) || !shaPattern.test(ledger.sha) || !shaPattern.test(baseline.sha) ||
      baseline.baseline !== ledger.sha || !Array.isArray(ledger.entries) || !Array.isArray(baseline.runs))
    throw Error('Invalid reconciliation baseline');
  const entries = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  if (entries.size !== ledger.entries.length) throw Error('Duplicate P0 ID');
  const original = new Map(), observed = new Map(), reviewMap = new Map();
  function known(id) {
    if (!entries.has(id)) throw Error('Unknown P0 ID: ' + id);
    return entries.get(id);
  }
  for (const run of baseline.runs) {
    if (run.sha !== baseline.sha || !Array.isArray(run.entries)) throw Error('Mixed baseline execution');
    for (const id of run.entries) {
      known(id);
      if (run.result !== 'passed') continue;
      const scenarios = original.get(id) ?? [];
      scenarios.push(run.scenario);
      original.set(id, scenarios);
    }
  }
  for (const [observationIndex, run] of observations.entries()) {
    if (!shaPattern.test(run.sha) || !Array.isArray(run.records)) throw Error('Invalid observation');
    for (const record of run.records) {
      if (record.sha !== run.sha || !record.scenario?.trim() || !Array.isArray(record.ui) ||
          !Array.isArray(record.executed) || record.platform !== 'darwin' || record.arch !== 'arm64')
        throw Error('Mixed-source or invalid native scenario');
      for (const id of record.executed) {
        const entry = known(id);
        // A background listener in an unrelated family earns no association.
        if (!entry.uiBehavior || !record.ui.includes(entry.uiBehavior)) continue;
        const assertions = observed.get(id) ?? [];
        assertions.push({ observation: observationIndex, sha: run.sha,
          scenario: record.scenario, complete: run.complete === true });
        observed.set(id, assertions);
      }
    }
  }
  const dispositions = ['needs-test', 'existing-assertion-needs-replay', 'unwired', 'mapping-review'];
  for (const review of reviews) {
    const entry = known(review.id);
    if (!entry.uiBehavior || reviewMap.has(review.id) || !dispositions.includes(review.disposition) ||
        !review.reason?.trim() || !Array.isArray(review.references) || !review.references.length ||
        review.references.some((ref) => !ref || typeof ref.file !== 'string' || !ref.file.trim() ||
          !Number.isInteger(ref.line) || ref.line < 1))
      throw Error('Incomplete or duplicate callback review: ' + review.id);
    reviewMap.set(review.id, review);
  }
  const reviewed = new Map(), associationKeys = new Set();
  for (const association of associations) {
    known(association.id);
    const key = JSON.stringify([association.id, association.observation, association.scenario]);
    const trace = (observed.get(association.id) ?? []).find((record) =>
      record.observation === association.observation && record.scenario === association.scenario);
    if (!trace || !association.reason?.trim() || !Array.isArray(association.references) ||
        !association.references.length || association.references.some((ref) => !ref ||
          typeof ref.file !== 'string' || !ref.file.trim() || !Number.isInteger(ref.line) || ref.line < 1) ||
        associationKeys.has(key)) throw Error('Invalid or duplicate reviewed association: ' + association.id);
    associationKeys.add(key);
    const matches = reviewed.get(association.id) ?? [];
    matches.push({ ...trace, reason: association.reason, references: association.references });
    reviewed.set(association.id, matches);
  }
  const rows = ledger.entries.filter((entry) => entry.uiBehavior).map((entry) => {
    const assertions = observed.get(entry.id) ?? [], review = reviewMap.get(entry.id);
    const reviewedAssertions = reviewed.get(entry.id) ?? [];
    const currentReviewed = reviewedAssertions.filter((a) => a.sha === currentSha);
    const current = assertions.filter((a) => a.sha === currentSha);
    const status = currentReviewed.some((a) => a.complete) ? 'reviewed-current-complete-assertion'
      : currentReviewed.length ? 'reviewed-current-partial-assertion'
      : current.some((a) => a.complete) ? 'current-complete-trace-needs-review'
      : current.length ? 'current-partial-trace-needs-review'
      : review?.disposition ?? 'needs-assertion-review';
    return {
      id: entry.id, file: entry.file, line: entry.line, uiBehavior: entry.uiBehavior,
      callback: entry.callback, acceptanceCaseId: entry.acceptanceCaseId,
      previouslyAssociated: original.has(entry.id),
      historicalScenarios: original.get(entry.id) ?? [], status,
      assertions, reviewedAssertions, ...(review ? { review } : {}),
      // Family references are a search aid, not a per-callback coverage claim.
      candidateAssertions: candidates.filter((candidate) => candidate.ui.includes(entry.uiBehavior)),
    };
  });
  const priorMissing = rows.filter((row) => !row.previouslyAssociated);
  const countStatuses = (set) => Object.fromEntries([...new Set(set.map((row) => row.status))].sort()
    .map((status) => [status, set.filter((row) => row.status === status).length]));
  return {
    schemaVersion: 1, baseline: ledger.sha, previousSha: baseline.sha, currentSha,
    releaseEligible: false,
    limitations: [
      'Callback association is not a product completion rate or branch coverage.',
      'Family-level source references are candidates for review, not execution evidence.',
      'An explicit reviewed association confirms only its stated scenario, not every branch of that callback.',
      'Partial/focused runs and historical SHAs never satisfy current complete acceptance.',
      'HEAD labels do not prove a clean build; inspect each observation provenance and dirty test patch.',
      'Use check-release-evidence.mjs separately with reviewed execution receipts.',
    ],
    summary: { total: rows.length, previouslyAssociated: rows.length - priorMissing.length,
      priorMissing: priorMissing.length, statuses: countStatuses(rows), priorMissingStatuses: countStatuses(priorMissing),
      priorMissingWithReviewedCurrentAssertion: priorMissing.filter((row) =>
        row.reviewedAssertions.some((a) => a.sha === currentSha)).length,
      reviewsRecorded: rows.filter((row) => row.review).length,
      reviewDispositions: countStatuses(rows.filter((row) => row.review)
        .map((row) => ({ status: row.review.disposition }))),
      unresolvedMappingReviews: rows.filter((row) => row.review?.disposition === 'mapping-review').length },
    observations: observations.map(({ records, ...metadata }) => ({ ...metadata, scenarios: records.length })),
    groups: [...new Set(priorMissing.map((row) => row.file))].map((file) => {
      const group = priorMissing.filter((row) => row.file === file);
      return { file, missingBefore: group.length, statuses: countStatuses(group) };
    }),
    rows,
  };
}

export function runCLI(args) {
  const [ledgerFile, previousFile, manifestFile, output] = args;
  if (!output) throw Error('Usage: reconcile-ui-evidence.mjs LEDGER PREVIOUS_RECEIPTS MANIFEST OUTPUT');
  const manifest = readJSON(manifestFile), base = path.dirname(path.resolve(manifestFile));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const observations = (manifest.observations ?? []).map((run) => ({
    label: run.label, ...loadNativeObservation(path.resolve(base, run.directory), run.sha),
  }));
  const report = reconcileUIEvidence({ ledger: readJSON(ledgerFile), baseline: readJSON(previousFile),
    currentSha: manifest.currentSha, observations, reviews: manifest.reviews ?? [],
    associations: manifest.associations ?? [],
    candidates: assertionCandidates(root) });
  report.inputs = [ledgerFile, previousFile, manifestFile].map((file) => ({
    file: path.relative(base, path.resolve(file)), sha256: digest(fs.readFileSync(file)),
  }));
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runCLI(process.argv.slice(2));
