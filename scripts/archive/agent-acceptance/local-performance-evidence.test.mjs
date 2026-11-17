import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latencyLimit, assessPerformanceRound } from './local-performance-evidence.mjs';
function fixture() {
  const row = { status: 50, diff: 30, history: 20, terminalOutput: 40 };
  const worker = () => ({ rows: [structuredClone(row)], peakRssKiB: 100, remainingProcesses: [] });
  const side = () => ({ cold: Array.from({ length: 20 }, worker), warm: { ...worker(), rows: Array.from({ length: 20 }, () => structuredClone(row)) } });
  return { schemaVersion: 1, platform: 'darwin', arch: 'arm64', samples: 20, methodology: { paired: true }, results: ['small', 'many-files', 'large-file', 'lfs'].map(name => ({ name, ...side(), baseline: side() })) };
}
test('confirmed performance boundary switches at 50ms and uses all 80 comparisons', () => {
  assert.equal(latencyLimit(49), 59); assert.equal(latencyLimit(50), 60);
  const result = assessPerformanceRound(fixture()); assert.equal(result.total, 80); assert.equal(result.passed, 80); assert.equal(result.eligible, true);
});
test('performance assessment refuses missing LFS, insufficient samples and observed regressions', () => {
  const missing = fixture(); missing.results.pop(); assert.equal(assessPerformanceRound(missing).eligible, false);
  const samples = fixture(); samples.samples = 19; assert.throws(() => assessPerformanceRound(samples));
  const slow = fixture(); slow.results[0].warm.rows[18].terminalOutput = 100; slow.results[0].warm.rows[19].terminalOutput = 110;
  assert.equal(assessPerformanceRound(slow).eligible, false);
  const leak = fixture(); leak.results[0].cold[0].remainingProcesses = [123]; assert.equal(assessPerformanceRound(leak).eligible, false);
});
