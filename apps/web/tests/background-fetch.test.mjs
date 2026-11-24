import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProtocolError } from '@alune/protocol';
import { createBackgroundFetchScheduler } from '../src/hooks/backgroundFetchScheduler.ts';

const preferences = { enabled: true, intervalMinutes: 5, excludedRepositoryIds: [] };
const repo = (id, connectionId) => ({
  id,
  path: `/${id}`,
  name: id,
  source: connectionId ? 'ssh' : 'local',
  connectionId,
});
const drain = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 60_000 });
  const calls = [];
  const results = [];
  const state = new Map();
  const scheduler = createBackgroundFetchScheduler({
    fetch: (repo, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ id: repo.id, resolve, reject, signal });
      }),
    report: (id, status) => (status ? state.set(id, status) : state.delete(id)),
    completed: async (repo) => {
      results.push(repo.id);
    },
  });
  t.after(() => scheduler.stop());
  return { scheduler, state, calls, results };
}

test('background fetch respects the interval and uses at most one task per SSH host', async (t) => {
  const { scheduler, calls, results } = fixture(t);
  const repositories = [repo('host-1-a', 'host-1'), repo('host-1-b', 'host-1'), repo('local')];
  const sync = (prefs) => scheduler.reconcile(prefs, repositories, () => undefined);
  sync({ ...preferences, enabled: false });
  assert.equal(calls.length, 0);
  sync(preferences);
  assert.deepEqual(
    calls.map((call) => call.id),
    ['host-1-a', 'local'],
  );
  calls[0].resolve({ fetched: true });
  await drain();
  assert.equal(calls[2].id, 'host-1-b');
  calls[1].resolve({ fetched: false });
  calls[2].resolve({ fetched: true });
  await drain();
  t.mock.timers.tick(5 * 60_000 - 1);
  assert.equal(calls.length, 3);
  t.mock.timers.tick(1);
  assert.equal(calls.length, 5);
  assert.deepEqual(results, ['host-1-a', 'local', 'host-1-b']);
});

test('disabling or disconnecting cancels a running fetch and ignores late results', async (t) => {
  const { scheduler, state, calls, results } = fixture(t);
  const repositories = [repo('remote', 'host')];
  scheduler.reconcile(preferences, repositories, () => undefined);
  scheduler.reconcile(preferences, repositories, () => 'SSH 已断开');
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(state.get('remote').phase, 'paused');
  scheduler.reconcile(preferences, repositories, () => undefined);
  assert.equal(calls.length, 1);
  calls[0].resolve({ fetched: true });
  await drain();
  assert.equal(calls.length, 2);
  assert.deepEqual(results, []);
  scheduler.reconcile(
    { ...preferences, excludedRepositoryIds: ['remote'] },
    repositories,
    () => undefined,
  );
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(state.has('remote'), false);
  calls[1].resolve({ fetched: true });
  await drain();
  t.mock.timers.tick(20 * 60_000);
  assert.equal(calls.length, 2);
  assert.deepEqual(results, []);
});

test('proxy and busy failures surface a pause and retry without starting a parallel fetch', async (t) => {
  const { scheduler, state, calls } = fixture(t);
  scheduler.reconcile(preferences, [repo('a')], () => undefined);
  calls[0].reject(
    new ProtocolError('unavailable', '代理无法建立连接', 'unknown', {
      code: 'PROXY_UNAVAILABLE',
    }),
  );
  await drain();
  assert.equal(state.get('a').phase, 'paused');
  assert.match(state.get('a').reason, /代理/);
  t.mock.timers.tick(60_000 - 1);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  calls[1].reject(new ProtocolError('busy', '仓库已被占用'));
  await drain();
  assert.match(state.get('a').reason, /其他操作/);
  t.mock.timers.tick(120_000);
  calls[2].resolve({ fetched: true });
  await drain();
  assert.equal(state.get('a').phase, 'success');
  assert.equal(state.get('a').reason, undefined);
});
