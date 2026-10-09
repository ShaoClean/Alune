import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
const commit = (hash) => ({ hash, parents: [], references: [] });
const page = (hashes, more = false, nextSkip = hashes.length, revision = 'r1') => ({
  commits: hashes.map(commit),
  hasMore: more,
  nextSkip,
  revision,
  shallow: false,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
let store;
const ws = (id = 'a') => store.getState().workspaces[id];
beforeEach(() => {
  store = createRepositoryStore();
  store.getState().activateWorkspace('a');
});

test('pages append once and use server offsets even when defensive deduplication removes a row', async () => {
  const calls = [];
  repositoryApi.log = async (id, options) => {
    calls.push(options);
    return calls.length === 1 ? page(['a', 'b'], true, 50) : page(['b', 'c'], false, 100);
  };
  await store.getState().fetchLog('a');
  const generation = ws().logGeneration;
  await store.getState().fetchLog('a', 'more');
  assert.deepEqual(
    ws().log.map((item) => item.hash),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(calls[1], { count: 50, skip: 50, revision: 'r1' });
  assert.equal(ws().logNextSkip, 100);
  assert.equal(ws().logGeneration, generation);
  await store.getState().fetchLog('a', 'more');
  assert.equal(calls.length, 2);
});

test('duplicate loading clicks share one append and failures preserve data for retry', async () => {
  repositoryApi.log = async () => page(['a'], true);
  await store.getState().fetchLog('a');
  const pending = deferred();
  let calls = 0;
  repositoryApi.log = () => {
    calls++;
    return pending.promise;
  };
  const first = store.getState().fetchLog('a', 'more');
  await store.getState().fetchLog('a', 'more');
  assert.equal(calls, 1);
  assert.equal(ws().logLoadingMore, true);
  pending.reject(new Error('offline'));
  await first;
  assert.deepEqual(
    ws().log.map((item) => item.hash),
    ['a'],
  );
  assert.equal(ws().logError, 'offline');
  assert.equal(ws().logErrorMode, 'more');
  repositoryApi.log = async () => page(['b']);
  await store.getState().fetchLog('a', 'more');
  assert.deepEqual(
    ws().log.map((item) => item.hash),
    ['a', 'b'],
  );
});

test('refresh replaces only on success and supersedes an older append response', async () => {
  repositoryApi.log = async () => page(['a'], true);
  await store.getState().fetchLog('a');
  const pending = deferred();
  repositoryApi.log = () => pending.promise;
  const append = store.getState().fetchLog('a', 'more');
  repositoryApi.log = async () => {
    throw new Error('refresh failed');
  };
  await store.getState().fetchLog('a');
  assert.deepEqual(
    ws().log.map((item) => item.hash),
    ['a'],
  );
  assert.equal(ws().logErrorMode, 'refresh');
  repositoryApi.log = async () => page(['new']);
  await store.getState().fetchLog('a');
  pending.resolve(page(['stale']));
  await append;
  assert.deepEqual(
    ws().log.map((item) => item.hash),
    ['new'],
  );
});

test('reference changes keep the visible history but prevent appending until refresh', async () => {
  repositoryApi.log = async () => page(['a'], true);
  await store.getState().fetchLog('a');
  let calls = 0;
  repositoryApi.log = async () => {
    calls++;
    throw { response: { data: { code: 'HISTORY_CHANGED', message: 'refresh required' } } };
  };
  await store.getState().fetchLog('a', 'more');
  await store.getState().fetchLog('a', 'more');
  assert.equal(calls, 1);
  assert.equal(ws().logChanged, true);
  assert.equal(ws().log[0].hash, 'a');
  repositoryApi.log = async () => page(['b'], false, 1, 'r2');
  await store.getState().fetchLog('a');
  assert.equal(ws().logChanged, false);
  assert.equal(ws().logRevision, 'r2');
});

test('each tab keeps its own history while another is shown; closing a tab aborts its reads', async () => {
  const pending = deferred();
  let signal;
  repositoryApi.log = (_id, _options, incoming) => {
    signal = incoming;
    return pending.promise;
  };
  const first = store.getState().fetchLog('a');
  store.getState().activateWorkspace('b');
  assert.equal(signal.aborted, false, 'a hidden tab keeps loading');
  repositoryApi.log = async () => page(['b']);
  await store.getState().fetchLog('b');
  pending.resolve(page(['a'], true));
  await first;
  assert.deepEqual(
    ws('a').log.map((item) => item.hash),
    ['a'],
  );
  assert.equal(ws('a').logHasMore, true);
  assert.deepEqual(
    ws('b').log.map((item) => item.hash),
    ['b'],
  );
  assert.equal(ws('b').logHasMore, false);
  const late = deferred();
  repositoryApi.log = (_id, _options, incoming) => {
    signal = incoming;
    return late.promise;
  };
  const closing = store.getState().fetchLog('a');
  store.getState().disposeWorkspaces(['a']);
  assert.equal(signal.aborted, true);
  late.resolve(page(['late']));
  await closing;
  assert.equal(ws('a'), undefined, 'a late page cannot resurrect a closed tab');
  store.getState().activateWorkspace('a');
  assert.deepEqual(ws('a').log, []);
  assert.equal(ws('a').logRevision, null);
});

test('commit-file failures belong only to the selected commit and cannot duplicate a global notice', async () => {
  repositoryApi.commitFiles = async () => {
    throw new Error('commit files unavailable');
  };
  await store.getState().fetchCommitFiles('a', 'commit-a');
  assert.equal(ws().commitFilesError, 'commit files unavailable');
  assert.equal(ws().error, null);
});

test('blame jumps start at an older commit and pagination retains that revision scope', async () => {
  const calls = [];
  repositoryApi.log = async (id, options) => {
    calls.push(options);
    return calls.length === 1
      ? page(['old', 'parent'], true, 50, 'focused')
      : page(['older'], false, 51, 'focused');
  };
  await store.getState().fetchLog('a', 'refresh', 'old');
  await store.getState().fetchLog('a', 'more');
  assert.deepEqual(calls[0], { count: 50, branch: 'old' });
  assert.deepEqual(calls[1], { count: 50, branch: 'old', skip: 50, revision: 'focused' });
  await store.getState().fetchLog('a');
  assert.equal(calls[2].branch, undefined);
  assert.equal(ws().logBranch, undefined);
});

test('filters reach every page, survive refreshes and are cleared by a jump to one commit', async () => {
  const calls = [];
  repositoryApi.log = async (id, options) => {
    calls.push(options);
    return page(['x'], calls.length === 1, 50, 'filtered');
  };
  const filter = { search: 'fix', author: 'Bob', since: 100, until: 200, currentBranch: true };
  await store.getState().setLogFilter('a', { ...filter, file: 'src/a.ts', follow: true });
  await store.getState().fetchLog('a', 'more');
  const expected = {
    count: 50,
    branch: 'HEAD',
    search: 'fix',
    author: 'Bob',
    since: 100,
    until: 200,
    file: 'src/a.ts',
    follow: true,
  };
  assert.deepEqual(calls[0], expected);
  assert.deepEqual(calls[1], { ...expected, skip: 50, revision: 'filtered' });
  // Tag, branch and toolbar refreshes keep what the user filtered by.
  await store.getState().fetchLog('a');
  assert.deepEqual(calls[2], expected);
  await store.getState().fetchLog('a', 'refresh', 'old');
  assert.deepEqual(calls[3], { count: 50, branch: 'old' });
  assert.deepEqual(ws().logFilter, {});
  await store.getState().setLogFilter('a', { follow: true });
  assert.deepEqual(calls[4], { count: 50 }, 'rename tracking needs a file');
  store.getState().activateWorkspace('b');
  assert.deepEqual(ws('b').logFilter, {});
  assert.deepEqual(ws('a').logFilter, { follow: true }, 'another tab keeps its filter');
});

test('filters that hide commits switch the graph to a chain; a path alone keeps the topology', async () => {
  const { historyFilterActive, linearHistory } = await import('../src/stores/repositoryStore.ts');
  assert.equal(historyFilterActive({}), false);
  assert.equal(historyFilterActive({ search: '', currentBranch: false }), false);
  assert.equal(historyFilterActive({ currentBranch: true }), true);
  assert.equal(linearHistory({ file: 'src', currentBranch: true }), false);
  for (const filter of [
    { search: 'a' },
    { author: 'a' },
    { since: 1 },
    { until: 1 },
    { file: 'a', follow: true },
  ])
    assert.equal(linearHistory(filter), true, JSON.stringify(filter));
});

test('date inputs cover whole local days and drafts drop empty fields', async () => {
  const { dateInput, dateSeconds, draftFilter, toDraft } =
    await import('../src/components/history-filter.ts');
  const since = dateSeconds('2026-03-05');
  const until = dateSeconds('2026-03-05', true);
  assert.equal(until - since, 86399);
  assert.equal(new Date(since * 1000).getHours(), 0);
  assert.equal(dateInput(since), '2026-03-05');
  assert.equal(dateInput(until), '2026-03-05');
  assert.equal(dateSeconds('03/05/2026'), undefined);
  assert.deepEqual(
    draftFilter({
      search: '  fix ',
      author: '',
      since: '',
      until: '2026-03-05',
      file: './src/a.ts',
      follow: true,
      currentBranch: false,
    }),
    { search: 'fix', until, file: 'src/a.ts', follow: true },
  );
  assert.deepEqual(draftFilter({ ...toDraft({}), follow: true }), {}, 'no file, no follow');
  assert.deepEqual(draftFilter(toDraft({ file: 'a', follow: true, since })), {
    since,
    file: 'a',
    follow: true,
  });
});
