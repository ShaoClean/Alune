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
    async log() {
      throw new Error('unexpected legacy history');
    },
    async status() {
      return 'legacy status';
    },
    async context() {
      throw new Error('legacy context called');
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

test('history and signature reads repeat only after local invalidation, without accepting stale results', async () => {
  for (const kind of ['log', 'signatures']) {
    const f = make('agent'),
      calls = [];
    const read = (signal) =>
      kind === 'log'
        ? f.adapter.repository.log('repo', { count: 1 }, signal)
        : f.adapter.git.signatures('repo', ['a'.repeat(40)], signal);
    try {
      f.client.readRepository = async (_r, k, _p, { signal }) => {
        calls.push(k);
        if (calls.length === 1)
          return new Promise((_ok, reject) =>
            signal.addEventListener('abort', () => reject(new Error('Task cancelled')), {
              once: true,
            }),
          );
        return { fresh: true };
      };
      const pending = read();
      f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
      assert.deepEqual(await pending, { fresh: true });
      assert.deepEqual(calls, [kind, kind]);
      f.client.readRepository = async () => {
        throw new Error('verifier or history backend failed');
      };
      await assert.rejects(read(), /backend failed/);
    } finally {
      f.adapter.dispose();
    }
  }
});
test('aborting a superseded read does not dispatch another request', async () => {
  const f = make('agent'),
    user = new AbortController();
  let calls = 0;
  f.client.readRepository = async (_r, _k, _p, { signal }) => {
    calls++;
    return new Promise((_ok, reject) =>
      signal.addEventListener('abort', () => reject(new Error('Task cancelled')), { once: true }),
    );
  };
  try {
    const pending = f.adapter.repository.log('repo', { count: 1 }, user.signal);
    f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
    await new Promise((r) => setTimeout(r, 5));
    user.abort(new Error('left history view'));
    await assert.rejects(pending, /left history view/);
    assert.equal(calls, 1);
  } finally {
    f.adapter.dispose();
  }
});

for (const kind of ['status', 'context'])
  test(
    kind +
      ' cancelled by an observed repository change refreshes the same owner and parameters, but caller cancellation and backend errors remain visible',
    async () => {
      const f = make('agent');
      const read = (signal) =>
        kind === 'status'
          ? f.adapter.repository.status('repo', signal, true)
          : f.adapter.repository.context('repo', signal);
      try {
        const calls = [];
        f.client.readRepository = async (ref, kind, params, { signal }) => {
          calls.push([ref, kind, params]);
          if (calls.length === 1)
            return new Promise((_ok, reject) =>
              signal.addEventListener('abort', () => reject(new Error('Task cancelled')), {
                once: true,
              }),
            );
          return { currentBranch: 'after-mutation', files: [] };
        };
        const pending = read();
        f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
        assert.deepEqual(await pending, { currentBranch: 'after-mutation', files: [] });
        assert.deepEqual(
          calls,
          Array(2).fill([resource, kind, kind === 'status' ? { foreground: true } : {}]),
        );
        let attempts = 0;
        f.client.readRepository = async (_ref, _kind, _params, { signal }) => {
          attempts++;
          return new Promise((_ok, reject) =>
            signal.addEventListener('abort', () => reject(new Error('Task cancelled')), {
              once: true,
            }),
          );
        };
        const user = new AbortController(),
          abandoned = read(user.signal);
        user.abort();
        await assert.rejects(abandoned, /Task cancelled|aborted/i);
        f.client.readRepository = async () => {
          attempts++;
          throw new Error('backend unavailable');
        };
        await assert.rejects(read(), /backend unavailable/);
        assert.equal(attempts, 2);
      } finally {
        f.adapter.dispose();
      }
    },
  );
