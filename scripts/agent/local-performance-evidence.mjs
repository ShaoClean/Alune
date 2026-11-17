import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPolicy } from './acceptance-policy.mjs';
export const performancePolicy = {
  source: 'https://github.com/ShaoClean/Alune/wiki/Issue-249-Decisions',
  latency: 'baseline >= 50 ms: candidate <= baseline * 1.20; baseline < 50 ms: candidate <= baseline + 10 ms',
  rss: 'candidate aggregate peak RSS <= baseline * 1.20',
  cleanup: 'no observed remaining process in either implementation',
  samples: 20,
  profiles: ['small', 'many-files', 'large-file', 'lfs'],
};
export const latencyLimit = baseline => baseline >= 50 ? baseline * 1.2 : baseline + 10;
const rank = (values, quantile) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1];
const digest = value => createHash('sha256').update(value).digest('hex');
export function assessPerformanceRound(report) {
  assert.equal(report.schemaVersion, 1); assert.equal(report.platform, 'darwin'); assert.equal(report.arch, 'arm64');
  assert(report.samples >= 20); assert.equal(report.methodology.paired, true);
  const names = report.results.map(r => r.name); assert.equal(new Set(names).size, names.length);
  assert(names.every(name => performancePolicy.profiles.includes(name)));
  const missingProfiles = performancePolicy.profiles.filter(name => !names.includes(name));
  const checks = [];
  for (const profile of report.results) for (const phase of ['cold', 'warm']) {
    const workers = value => phase === 'cold' ? value.cold : [value.warm];
    const baselineWorkers = workers(profile.baseline), candidateWorkers = workers(profile);
    const rows = workers => workers.flatMap(w => w.rows);
    const baseline = rows(baselineWorkers), candidate = rows(candidateWorkers);
    assert.equal(baseline.length, report.samples); assert.equal(candidate.length, report.samples);
    for (const row of [...baseline, ...candidate]) {
      assert.deepEqual(Object.keys(row).sort(), ['diff', 'history', 'status', 'terminalOutput']);
      assert(Object.values(row).every(value => Number.isFinite(value) && value >= 0));
    }
    for (const metric of ['status', 'diff', 'history', 'terminalOutput']) for (const quantile of [0.5, 0.95]) {
      const old = rank(baseline.map(r => r[metric]), quantile), value = rank(candidate.map(r => r[metric]), quantile), limit = latencyLimit(old);
      checks.push({ profile: profile.name, phase, metric, quantile, baseline: old, candidate: value, limit, passed: value <= limit });
    }
    for (const worker of [...baselineWorkers, ...candidateWorkers]) {
      assert(Number.isFinite(worker.peakRssKiB) && worker.peakRssKiB > 0); assert(Array.isArray(worker.remainingProcesses));
    }
    const peak = workers => Math.max(...workers.map(w => w.peakRssKiB));
    const old = peak(baselineWorkers), value = peak(candidateWorkers);
    checks.push({ profile: profile.name, phase, metric: 'aggregate peak RSS KiB', baseline: old, candidate: value, limit: old * 1.2, passed: value <= old * 1.2 });
    const remaining = [...baselineWorkers, ...candidateWorkers].flatMap(w => w.remainingProcesses);
    checks.push({ profile: profile.name, phase, metric: 'observed process cleanup', remaining, passed: remaining.length === 0 });
  }
  return { missingProfiles, checks, passed: checks.filter(c => c.passed).length, total: checks.length,
    eligible: missingProfiles.length === 0 && checks.length === 80 && checks.every(c => c.passed) };
}
export function main(args) {
  const [beforeFile, baselineRoot, firstFile, secondFile, outputArg, policyFile, bundleArg, sealedManifestFile] = args;
  if (!sealedManifestFile) throw Error('Usage: local-performance-evidence.mjs INPUTS_BEFORE BASELINE_ROOT ROUND1 ROUND2 NEW_OUTPUT POLICY MEASURED_BUNDLE PRE_RUN_SEALED_MANIFEST');
  const root = fileURLToPath(new URL('../../', import.meta.url)), policy = readPolicy(policyFile);
  assert.equal(policy.id, 'mac-arm64-local-2026-11-08');
  const before = JSON.parse(fs.readFileSync(beforeFile));
  for (const [label, base] of [['current', root], ['baseline', baselineRoot]])
    for (const [file, expected] of Object.entries(before.inputs[label])) assert.equal(digest(fs.readFileSync(path.join(base, file))), expected, 'Performance input changed: ' + label + '/' + file);
  const files = [firstFile, secondFile], reports = files.map(file => JSON.parse(fs.readFileSync(file)));
  assert.equal(reports[0].osRelease, reports[1].osRelease); assert.equal(reports[0].node, reports[1].node);
  assert.equal(reports[0].lfsVersion, reports[1].lfsVersion);
  for (const report of reports) { assert.equal(report.sha, before.sha); assert.equal(report.implementationSha, before.baseline); }
  const manifestBytes = fs.readFileSync(path.join(bundleArg, 'manifest.json'));
  assert(manifestBytes.equals(fs.readFileSync(sealedManifestFile)), 'Measured bundle manifest differs from the pre-run clean-package receipt');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.sourceSha, before.sha); assert.equal(manifest.dirty, false);
  assert.equal('v' + manifest.node.version, reports[0].node);
  for (const [file, expected] of Object.entries(manifest.files)) assert.equal(digest(fs.readFileSync(path.join(bundleArg, file))), expected, 'Measured bundle changed: ' + file);
  const rounds = reports.map(assessPerformanceRound), eligible = rounds.every(r => r.eligible);
  const output = path.resolve(outputArg); fs.mkdirSync(output, { recursive: false });
  const results = files.map((file, index) => { const bytes = fs.readFileSync(file), name = 'round-' + (index + 1) + '.json'; fs.writeFileSync(path.join(output, name), bytes); return { name: 'round-' + (index + 1), log: { path: name, sha256: digest(bytes) } }; });
  const proof = { sha: before.sha, baseline: before.baseline, policy: performancePolicy, inputs: before.inputs,
    measuredBundle: { manifestSha256: digest(manifestBytes), manifest, verification: 'Post-run byte verification against the unchanged clean manifest archived before measurement; not a new measurement or a retroactive pre-run capture.' },
    rounds, results, eligible,
    limitations: 'Fresh application processes; OS cache is not flushed. Local production UI-host IPC versus frozen HTTP/Socket.IO, real Git and PTY; no Chromium render or SSH timing. Aggregate RSS/process sets sampled every 25ms may miss short-lived/orphan processes. Both fresh rounds and all four profiles are mandatory; historical or partial passes cannot replace a failed round.' };
  const bytes = JSON.stringify(proof, null, 2) + '\n'; fs.writeFileSync(path.join(output, 'performance.json'), bytes);
  const runs = [{ sha: before.sha, target: 'darwin-arm64', gate: 'performance', entries: [], result: eligible ? 'passed' : 'failed', scenario: 'Two fresh local Mac performance rounds', assertion: 'Nearest-rank p50/p95, aggregate peak RSS and observed process cleanup assessed against the frozen confirmed thresholds. ' + rounds.map((r, i) => `Round ${i + 1}: ${r.passed}/${r.total}, missing ${r.missingProfiles.join(',') || 'none'}`).join('; '), limitations: proof.limitations, proof: { path: 'performance.json', sha256: digest(bytes) } }];
  fs.writeFileSync(path.join(output, 'receipts.json'), JSON.stringify({ stage: 'after-retirement', sha: before.sha, baseline: before.baseline, policy: policy.id, runs }, null, 2) + '\n');
  console.log(JSON.stringify({ eligible, rounds: rounds.map(r => ({ passed: r.passed, total: r.total, missingProfiles: r.missingProfiles, failures: r.checks.filter(c => !c.passed) })) }));
  if (!eligible) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
