import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRepositoryOverview, syncLabel } from '../src/stores/repositoryOverview.ts';
const now = Date.parse('2026-10-01T12:00:00Z');
const repos = Array.from({ length: 8 }, (_, i) => ({
  id: `${i}`,
  name: `repo-${i}`,
  source: i < 4 ? 'local' : 'ssh',
  connectionId: 'host',
}));
const entry = (data, patch = {}) => ({
  phase: 'success',
  updatedAt: now,
  data: { branch: 'main', files: [], ahead: 0, behind: 0, upstream: 'origin/main', ...data },
  ...patch,
});
const statuses = {
  0: entry({
    files: [
      { path: 'a', staged: true },
      { path: 'a', staged: false },
    ],
    ahead: 1,
    behind: 2,
  }),
  1: entry({}),
  2: entry({}, { updatedAt: now - 60000 }),
  3: entry({}, { phase: 'error' }),
  4: entry({ upstream: '', ahead: 2 }),
  5: entry({ branch: '' }),
  6: entry({ unborn: true }),
};
const analytics = Object.fromEntries(
  repos.slice(0, 6).map((repo, i) => [
    repo.id,
    {
      id: repo.id,
      data: {
        endDay: '2026-10-01',
        daily: Array.from({ length: 180 }, (_, day) => (day === 179 ? i + 1 : day === 172 ? 2 : 0)),
        collectedAt: now,
        language: i % 2 ? 'TypeScript' : 'Python',
        shallow: false,
        truncated: false,
      },
    },
  ]),
);

test('mutually exclusive states, deduplicated pending sync union and changed paths', () => {
  const data = buildRepositoryOverview(repos, statuses, analytics, 7, now);
  assert.deepEqual(
    data.states.map((state) => state.rows.length),
    [4, 1, 3],
  );
  assert.equal(
    data.states.reduce((n, state) => n + state.rows.length, 0),
    repos.length,
  );
  assert.equal(data.syncedPending.length, 1);
  assert.equal(data.rows[0].changedFiles, 1);
  assert.equal(syncLabel(data.rows[4]), '无上游');
  assert.equal(syncLabel(data.rows[5]), '游离 HEAD');
  assert.equal(syncLabel(data.rows[6]), '未首次提交');
  assert.equal(syncLabel(data.rows[7]), '同步待确认');
});
test('all 15 source and period combinations conserve totals and intersection drilldowns', () => {
  for (const filter of [
    () => true,
    (r) => r.source === 'local',
    (r) => r.connectionId === 'host' && r.source === 'ssh',
    (r) => r.id === '0',
    () => false,
  ]) {
    for (const days of [7, 30, 90]) {
      const data = buildRepositoryOverview(repos.filter(filter), statuses, analytics, days, now);
      assert.equal(
        data.commits,
        data.rows.reduce((n, r) => n + (r.commits || 0), 0),
      );
      assert.equal(
        data.sources.reduce((n, s) => n + s.rows.length, 0),
        data.rows.length,
      );
      assert.equal(
        data.languages.reduce((n, s) => n + s.rows.length, 0),
        data.rows.length,
      );
      assert.equal(data.current.length, days);
      assert.ok(data.ranking.every((r) => data.rows.includes(r)));
      for (const source of data.sources)
        for (const state of data.states) {
          assert.deepEqual(
            data.rows.filter((r) => r.source === source.source && r.state === state.state),
            source.rows.filter((r) => r.state === state.state),
          );
        }
    }
  }
});
test('period boundaries use complete UTC days, with the preceding equal period', () => {
  const seven = buildRepositoryOverview(repos, statuses, analytics, 7, now);
  assert.equal(seven.dates[0], '2026-09-24');
  assert.equal(seven.dates.at(-1), '2026-09-30');
  assert.equal(seven.previousDates[0], '2026-09-17');
  assert.equal(seven.previousDates.at(-1), '2026-09-23');
  assert.equal(seven.commits, 21);
  assert.equal(seven.previousCommits, 12);
  const thirty = buildRepositoryOverview(repos, statuses, analytics, 30, now);
  assert.equal(thirty.commits, 33);
  assert.equal(thirty.previousCommits, 0);
  assert.deepEqual(
    seven.states.map((s) => [s.state, s.rows.map((r) => r.repo.id)]),
    thirty.states.map((s) => [s.state, s.rows.map((r) => r.repo.id)]),
  );
  assert.deepEqual(
    seven.languages.map((s) => [s.language, s.rows.length]),
    thirty.languages.map((s) => [s.language, s.rows.length]),
  );
});
test('failed, old-day and expired cached statistics never masquerade as current zeroes', () => {
  for (const patch of [
    { error: 'offline' },
    { data: { ...analytics[0].data, collectedAt: now - 300000 } },
    { data: { ...analytics[0].data, endDay: '2026-09-30' } },
  ]) {
    const data = buildRepositoryOverview(
      [repos[0]],
      {},
      { 0: { ...analytics[0], ...patch } },
      7,
      now,
    );
    assert.equal(data.rows[0].commits, undefined);
    assert.equal(data.collected.length, 0);
    assert.equal(data.activityComplete, false);
    assert.equal(data.rows[0].language, '待采集');
  }
  assert.equal(
    buildRepositoryOverview(
      [repos[0]],
      {},
      { 0: { ...analytics[0], data: { ...analytics[0].data, shallow: true } } },
      7,
      now,
    ).activityComplete,
    false,
  );
});
