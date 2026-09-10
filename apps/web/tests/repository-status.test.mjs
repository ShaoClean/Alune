import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { createRepositoryStore } = await import('../src/stores/repositoryStore.ts');
const { useWorkspaceStore: workspace, hydrateWorkspace } =
  await import('../src/stores/workspaceStore.ts');
const { repositoryApi } = await import('../src/api/index.ts');
await hydrateWorkspace();
const repo = (id, connectionId = 'host-a') => ({
  id,
  connectionId,
  name: id,
  path: `/fixture/${id}`,
});
const status = (branch = 'main', dirty = false) => ({
  branch,
  files: dirty ? [{ path: 'file', staged: false, status: 'modified' }] : [],
  ahead: 2,
  behind: 1,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
let store;
beforeEach(() => {
  store = createRepositoryStore();
  workspace.setState(workspace.getInitialState(), true);
  storage.clear();
  repositoryApi.list = async () => [repo('a'), repo('b'), repo('c', 'host-b')];
  repositoryApi.status = async () => status();
  repositoryApi.delete = async () => {};
});

test('first list failure is distinct from an empty successful registry and from Git errors', async () => {
  store.setState({ error: 'an unrelated Git error' });
  repositoryApi.list = async () => {
    throw new Error('registry offline');
  };
  await store.getState().fetchRepositories();
  assert.equal(store.getState().listLoaded, false);
  assert.equal(store.getState().listLoading, false);
  assert.equal(store.getState().listError, 'registry offline');
  assert.equal(store.getState().error, 'an unrelated Git error');
  repositoryApi.list = async () => [];
  await store.getState().fetchRepositories();
  assert.equal(store.getState().listLoaded, true);
  assert.equal(store.getState().listError, null);
  assert.deepEqual(store.getState().repositories, []);
});

test('the registry becomes available without starting or waiting for remote reads; list refreshes coalesce', async () => {
  let lists = 0,
    statuses = 0;
  const pending = deferred();
  repositoryApi.list = () => {
    lists++;
    return pending.promise;
  };
  repositoryApi.status = () => {
    statuses++;
    return new Promise(() => {});
  };
  const a = store.getState().fetchRepositories('host-a');
  const b = store.getState().fetchRepositories('host-b');
  await flush();
  assert.equal(store.getState().listLoading, true);
  pending.resolve([repo('a'), repo('b', 'host-b')]);
  await Promise.all([a, b]);
  assert.equal(lists, 1);
  assert.equal(statuses, 0);
  assert.equal(store.getState().repositories.length, 2);
});

test('background concurrency is bounded, the current repository has a reserved slot, and failures are independent', async () => {
  await store.getState().fetchRepositories();
  const calls = [];
  const pending = new Map();
  repositoryApi.status = (id) => {
    calls.push(id);
    const item = deferred();
    pending.set(id, item);
    return item.promise;
  };
  const stops = ['a', 'b', 'c'].map((id) => store.getState().observeRepository(id));
  await flush();
  assert.deepEqual(calls, ['a', 'b']);
  store.getState().resetWorkspace('current');
  const current = store.getState().fetchStatus('current');
  await flush();
  assert.deepEqual(calls, ['a', 'b', 'current']);
  pending.get('b').resolve(status('fast'));
  await flush();
  assert.equal(store.getState().repositoryStatuses.b.data.branch, 'fast');
  assert.equal(store.getState().repositoryStatuses.a.phase, 'loading');
  assert.deepEqual(calls, ['a', 'b', 'current', 'c']);
  pending.get('a').reject(new Error('timeout'));
  pending.get('c').resolve(status());
  pending.get('current').resolve(status('active'));
  await current;
  await flush();
  assert.equal(store.getState().repositoryStatuses.a.phase, 'error');
  assert.equal(store.getState().status.branch, 'active');
  assert.equal(store.getState().repositories.length, 3);
  stops.forEach((stop) => stop());
});

test('the current repository is promoted ahead of queued visible work', async () => {
  const calls = [];
  const pending = new Map();
  repositoryApi.status = (id) => {
    calls.push(id);
    const item = deferred();
    pending.set(id, item);
    return item.promise;
  };
  const stops = ['a', 'b', 'c', 'd'].map((id) => store.getState().observeRepository(id));
  store.getState().resetWorkspace('d');
  const current = store.getState().fetchStatus('d');
  await flush();
  assert.deepEqual(calls, ['d', 'a', 'b']);
  stops[2](); // Scrolled away before its turn: never contact c.
  for (const item of pending.values()) item.resolve(status());
  await current;
  await flush();
  assert.deepEqual(calls, ['d', 'a', 'b']);
  stops.forEach((stop) => stop());
});

test('duplicate refreshes share a request, failure keeps cached data and timestamp, and manual retry recovers', async () => {
  await store.getState().fetchRepositories();
  await store.getState().refreshRepositoryStatuses(['a']);
  const cached = store.getState().repositoryStatuses.a;
  let calls = 0;
  const pending = deferred();
  repositoryApi.status = () => {
    calls++;
    return pending.promise;
  };
  const first = store.getState().refreshRepositoryStatuses(['a']);
  const second = store.getState().refreshRepositoryStatuses(['a']);
  await flush();
  assert.equal(calls, 1);
  pending.reject(new Error('offline'));
  await Promise.all([first, second]);
  assert.equal(store.getState().repositoryStatuses.a.updatedAt, cached.updatedAt);
  assert.deepEqual(store.getState().repositoryStatuses.a.data, cached.data);
  assert.equal(store.getState().repositoryStatuses.a.phase, 'error');
  const stop = store.getState().observeRepository('a');
  await flush();
  assert.equal(calls, 1); // no automatic retry storm
  repositoryApi.status = async () => status('recovered', true);
  await store.getState().refreshRepositoryStatuses(['a']);
  assert.equal(store.getState().repositoryStatuses.a.phase, 'success');
  assert.equal(store.getState().repositories[0].currentBranch, 'recovered');
  assert.equal(store.getState().repositories[0].isDirty, true);
  stop();
});

test('fresh visible cache is reused; expired cache refreshes when visible again', async (t) => {
  let now = 100_000,
    calls = 0;
  t.mock.method(Date, 'now', () => now);
  repositoryApi.status = async () => {
    calls++;
    return status();
  };
  await store.getState().refreshRepositoryStatuses(['a']);
  let stop = store.getState().observeRepository('a');
  await flush();
  stop();
  assert.equal(calls, 1);
  now += 60_001;
  stop = store.getState().observeRepository('a');
  await flush();
  stop();
  assert.equal(calls, 2);
});

test('status and failed registry refreshes preserve order, folds, and prior registration and summaries', async () => {
  await store.getState().fetchRepositories();
  workspace.getState().setConnectionCollapsed('host-a', true);
  workspace
    .getState()
    .moveTreeItem(
      { kind: 'repository', id: 'b', connectionId: 'host-a' },
      { kind: 'repository', id: 'a', connectionId: 'host-a' },
      'before',
    );
  const preferences = storage.get('remote-git-workspace');
  await store.getState().refreshRepositoryStatuses(['a']);
  const previous = store.getState().repositories;
  assert.equal(storage.get('remote-git-workspace'), preferences);
  repositoryApi.list = async () => {
    throw new Error('registry failed');
  };
  await store.getState().fetchRepositories();
  assert.equal(store.getState().repositories, previous);
  assert.equal(storage.get('remote-git-workspace'), preferences);
  repositoryApi.list = async () => [repo('a'), repo('b'), repo('c', 'host-b')];
  await store.getState().fetchRepositories();
  assert.equal(store.getState().repositories[0].currentBranch, 'main');
  assert.equal(storage.get('remote-git-workspace'), preferences);
});

test('switching cancels the previous foreground read and ignores its late response', async () => {
  await store.getState().fetchRepositories();
  const a = deferred(),
    b = deferred();
  repositoryApi.status = (id) => (id === 'a' ? a.promise : b.promise);
  store.getState().resetWorkspace('a');
  store.getState().setCurrentRepo(repo('a'));
  const first = store.getState().fetchStatus('a');
  store.getState().resetWorkspace('b');
  store.getState().setCurrentRepo(repo('b'));
  const second = store.getState().fetchStatus('b');
  b.resolve(status('new'));
  await second;
  a.resolve(status('old'));
  await first;
  assert.equal(store.getState().status.branch, 'new');
  assert.equal(store.getState().currentRepo.id, 'b');
  assert.equal(store.getState().repositoryStatuses.a, undefined);
  store.getState().resetWorkspace('a');
  assert.equal(store.getState().status, null);
});

test('deletion aborts pending status and late status or metadata cannot resurrect it', async () => {
  await store.getState().fetchRepositories();
  const pending = deferred();
  let signal;
  repositoryApi.status = (id, abortSignal) => {
    signal = abortSignal;
    return pending.promise;
  };
  store.getState().resetWorkspace('a');
  store.getState().openRepository(repo('a'));
  const refresh = store.getState().fetchStatus('a');
  await flush();
  await store.getState().deleteRepository('a');
  assert.equal(signal.aborted, true);
  pending.resolve(status('deleted'));
  await refresh;
  await flush();
  store.getState().setCurrentRepo(repo('a'));
  assert.equal(store.getState().repositoryStatuses.a, undefined);
  assert.equal(
    store.getState().repositories.some((item) => item.id === 'a'),
    false,
  );
  assert.equal(store.getState().openRepositories.length, 0);
  assert.equal(store.getState().status, null);
  assert.equal(store.getState().currentRepo, null);
  assert.deepEqual(workspace.getState().repositoryOrderByConnection['host-a'], ['b']);
});

test('a confirmed full registry removal prunes pending cache without accepting its late reply', async () => {
  await store.getState().fetchRepositories();
  const pending = deferred();
  repositoryApi.status = () => pending.promise;
  const refresh = store.getState().refreshRepositoryStatuses(['a']);
  await flush();
  repositoryApi.list = async () => [repo('b')];
  await store.getState().fetchRepositories();
  pending.resolve(status('removed'));
  await refresh;
  await flush();
  assert.equal(store.getState().repositoryStatuses.a, undefined);
  assert.deepEqual(store.getState().repositories, [repo('b')]);
});

test('a Git mutation waits for a pre-mutation read, then shares a fresh validation request', async () => {
  store.getState().resetWorkspace('a');
  const pending = deferred();
  let calls = 0;
  repositoryApi.status = () =>
    ++calls === 1 ? pending.promise : Promise.resolve(status('after-write', true));
  const before = store.getState().fetchStatus('a');
  await flush();
  const after = store.getState().fetchStatus('a', true);
  const duplicate = store.getState().fetchStatus('a', true);
  assert.equal(calls, 1);
  pending.resolve(status('before-write'));
  await Promise.all([before, after, duplicate]);
  assert.equal(calls, 2);
  assert.equal(store.getState().status.branch, 'after-write');
});

test('cancelling a retry preserves a previously failed cache as stale until a successful read', async () => {
  store.getState().resetWorkspace('a');
  await store.getState().fetchStatus('a');
  repositoryApi.status = async () => {
    throw new Error('offline');
  };
  await store.getState().fetchStatus('a');
  const pending = deferred();
  repositoryApi.status = () => pending.promise;
  const retry = store.getState().fetchStatus('a');
  await flush();
  store.getState().resetWorkspace('b');
  await retry;
  pending.resolve(status('late'));
  await flush();
  assert.equal(store.getState().repositoryStatuses.a.stale, true);
  assert.equal(store.getState().repositoryStatuses.a.data.branch, 'main');
  store.getState().resetWorkspace('a');
  repositoryApi.status = async () => status('recovered');
  await store.getState().fetchStatus('a');
  assert.equal(store.getState().repositoryStatuses.a.stale, false);
});
