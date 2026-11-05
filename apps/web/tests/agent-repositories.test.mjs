import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRepositoryQueries } from '../src/api/agent-repositories.ts';
const resource = { agentId: 'agent', resourceId: 'resource' };
const make = (executor = 'legacy') => {
  const calls = [],
    events = [];
  const client = {
    onEvent(fn) {
      events.push(fn);
      return () => events.splice(events.indexOf(fn), 1);
    },
    async readRepository(resource, kind, params, options) {
      calls.push({ resource, kind, params, options });
      return kind === 'diff' ? 'patch' : { diff: 'editable', revision: 'hash' };
    },
    async invalidateRepository() {
      calls.push('invalidate');
    },
  };
  const old = {
    async diff() {
      throw new Error('legacy query called');
    },
    async status() {
      return 'legacy status';
    },
  };
  const git = {
    async signatures() {
      throw new Error('legacy signature verifier called');
    },
    async stage() {
      calls.push('stage');
      return { success: true };
    },
  };
  return {
    client,
    calls,
    events,
    adapter: createAgentRepositoryQueries(
      client,
      (id) => (id === 'repo' ? resource : undefined),
      old,
      git,
      executor,
    ),
  };
};
test('query seam preserves plain/full/partial diff shapes and only routes selected repositories', async () => {
  const f = make();
  assert.equal(await f.adapter.repository.diff('repo', { file: 'a', fullFile: true }), 'patch');
  assert.deepEqual(f.calls[0].params, { file: 'a', fullFile: true });
  assert.deepEqual(
    await f.adapter.repository.diff('repo', {
      file: 'a',
      editable: true,
      fullFile: true,
      staged: true,
    }),
    { diff: 'editable', revision: 'hash' },
  );
  assert.equal(f.calls[1].kind, 'editableDiff');
  assert.equal(await f.adapter.repository.status('other'), 'legacy status');
  f.adapter.dispose();
});
test('legacy writes invalidate before and after once, including unknown failures; stale queries never apply', async () => {
  const f = make();
  let finish;
  f.client.readRepository = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const read = f.adapter.repository.diff('repo', { file: 'a' });
  const rejected = assert.rejects(read, /变化/);
  const result = await f.adapter.git.stage('repo', ['a']);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(f.calls, ['invalidate', 'stage', 'invalidate']);
  finish('stale');
  await rejected;
  f.adapter.dispose();
});
test('failed post-write invalidation never replays or falsifies a completed write and blocks next read until refreshed', async () => {
  const f = make();
  let count = 0;
  f.client.invalidateRepository = async () => {
    count++;
    if (count === 2) throw new Error('disconnected');
  };
  assert.deepEqual(await f.adapter.git.stage('repo', ['a']), { success: true });
  assert.equal(await f.adapter.repository.diff('repo', {}), 'patch');
  assert.equal(count, 3);
  assert.equal(f.calls.filter((c) => c === 'stage').length, 1);
  f.adapter.dispose();
});
test('resource change/resync rejects pending reads and disposal detaches listeners', async () => {
  const f = make();
  let finish;
  f.client.readRepository = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const read = f.adapter.repository.diff('repo', {});
  const rejected = assert.rejects(read);
  f.events[0]({ type: 'repositories.changed', resource });
  finish('stale');
  await rejected;
  f.adapter.dispose();
  assert.equal(f.events.length, 0);
});
test('selected P4 write sends the approved revision once, then queries its exact operation on unknown outcome', async () => {
  const f = make('agent');
  let dispatched;
  f.client.prepareRepositoryWrite = async (intent) => {
    assert.deepEqual(intent, { resource, kind: 'stage', args: [['a']] });
    return 'revision';
  };
  f.client.writeRepository = async (req) => {
    assert(!dispatched);
    dispatched = req;
    throw new Error('disconnected');
  };
  f.client.getTask = async (q) => {
    assert.deepEqual(q, { taskId: dispatched.operationId });
    return { task: { state: 'unknown' } };
  };
  await assert.rejects(f.adapter.git.stage('repo', ['a']), /请勿重复执行/);
  assert.equal(dispatched.revision, 'revision');
  assert.deepEqual(f.calls, []);
  await f.adapter.git.stage('unmapped', ['a']);
  assert.deepEqual(f.calls, ['stage']);
  f.adapter.dispose();
});

test('a superseded signature read is distinct from a failing verifier', async () => {
  const f = make('agent');
  const { SupersededSignatureRead } = await import('../src/api/repository-errors.ts');
  const adapter = f.adapter;
  try {
    f.client.readRepository = async (_resource, _kind, _params, { signal }) =>
      new Promise((_ok, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Task cancelled')), { once: true }),
      );
    const call = adapter.git.signatures('repo', ['a'.repeat(40)]);
    for (const listener of f.events) listener({ type: 'repositories.changed', resource });
    await assert.rejects(call, SupersededSignatureRead);
    f.client.readRepository = async () => {
      throw new Error('GPG failed');
    };
    await assert.rejects(adapter.git.signatures('repo', ['a'.repeat(40)]), /GPG failed/);
  } finally {
    adapter.dispose();
  }
});
