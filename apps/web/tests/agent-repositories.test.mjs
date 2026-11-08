import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolError } from '@alune/protocol';
import {
  createAgentFileWrite,
  createAgentRepositoryQueries,
} from '../src/api/agent-repositories.ts';
const resource = { agentId: 'agent', resourceId: 'resource' };
const make = () => {
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
  await assert.rejects(f.adapter.repository.status('other'), /尚未绑定 Agent/);
  f.adapter.dispose();
});
test('Agent writes invalidate pending reads and never call a previous writer', async () => {
  const f = make();
  let finish;
  f.client.readRepository = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const read = f.adapter.repository.diff('repo', { file: 'a' });
  const rejected = assert.rejects(read, /变化/);
  f.client.prepareRepositoryWrite = async () => 'revision';
  f.client.writeRepository = async () => {
    f.calls.push('agent stage');
    return { success: true };
  };
  const result = await f.adapter.git.stage('repo', ['a']);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(f.calls, ['agent stage']);
  finish('stale');
  await rejected;
  f.adapter.dispose();
});
test('failed explicit invalidation blocks reads until refreshed, with no alternate executor', async () => {
  const f = make();
  let count = 0;
  f.client.invalidateRepository = async () => {
    count++;
    if (count < 3) throw new Error('disconnected');
  };
  await assert.rejects(f.adapter.invalidate(resource), /disconnected/);
  await assert.rejects(f.adapter.repository.diff('repo', {}), /disconnected/);
  assert.equal(await f.adapter.repository.diff('repo', {}), 'patch');
  assert.equal(count, 3);
  assert.equal(f.calls.filter((c) => c === 'stage').length, 0);
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
  const f = make();
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
  await assert.rejects(f.adapter.git.stage('unmapped', ['a']), /尚未绑定 Agent/);
  assert.deepEqual(f.calls, []);
  f.adapter.dispose();
});

test('history and signature reads repeat only after local invalidation, without accepting stale results', async () => {
  for (const kind of ['log', 'signatures']) {
    const f = make(),
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
            signal.addEventListener(
              'abort',
              () => reject(new ProtocolError('cancelled', 'Task cancelled', 'completed')),
              {
                once: true,
              },
            ),
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
  const f = make(),
    user = new AbortController();
  let calls = 0;
  f.client.readRepository = async (_r, _k, _p, { signal }) => {
    calls++;
    return new Promise((_ok, reject) =>
      signal.addEventListener(
        'abort',
        () => reject(new ProtocolError('cancelled', 'Task cancelled', 'completed')),
        { once: true },
      ),
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
      const f = make();
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
              signal.addEventListener(
                'abort',
                () => reject(new ProtocolError('cancelled', 'Task cancelled', 'completed')),
                {
                  once: true,
                },
              ),
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
            signal.addEventListener(
              'abort',
              () => reject(new ProtocolError('cancelled', 'Task cancelled', 'completed')),
              {
                once: true,
              },
            ),
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

test('live metadata invalidated before its result arrives refreshes once with the original host and arguments', async () => {
  for (const [area, method, kind, args, params] of [
    ...['worktrees', 'submodules', 'lfs', 'branches', 'stashes', 'remotes'].map((k) => [
      'repository',
      k,
      k,
      [],
      {},
    ]),
    ['git', 'signingConfig', 'signing', [], {}],
    ['git', 'tags', 'tags', [], {}],
    ['git', 'remoteTags', 'tags', ['origin'], { remote: 'origin' }],
  ]) {
    const f = make();
    // Each member uses the same public facade shape as repositoryApi.
    const old = {
      [method]: async () => {
        throw new Error('unexpected legacy metadata');
      },
    };
    f.adapter.dispose();
    const adapter = createAgentRepositoryQueries(
      f.client,
      (id) => (id === 'repo' ? resource : undefined),
      area === 'repository' ? old : {},
      area === 'git' ? old : {},
    );
    const fresh = { generation: 'new', local: [], remote: [] };
    const expected =
      method === 'tags' ? fresh.local : method === 'remoteTags' ? fresh.remote : fresh;
    const read = () => adapter[area][method]('repo', ...args);
    try {
      const seen = [];
      f.client.readRepository = async (ref, method, params, { signal }) => {
        seen.push([ref, method, params]);
        if (seen.length === 1)
          return new Promise((_ok, reject) =>
            signal.addEventListener(
              'abort',
              () => reject(new ProtocolError('cancelled', 'Task cancelled', 'completed')),
              {
                once: true,
              },
            ),
          );
        return fresh;
      };
      const pending = read();
      await new Promise((r) => setImmediate(r));
      f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
      assert.deepEqual(await pending, expected);
      assert.deepEqual(seen, Array(2).fill([resource, kind, params]));
      f.client.readRepository = async () => {
        throw new Error('actual metadata failure');
      };
      await assert.rejects(read(), /actual metadata failure/);
    } finally {
      adapter.dispose();
      f.adapter.dispose();
    }
  }
});

test('a concurrent metadata invalidation cannot turn a genuine failure or unknown outcome into a retry', async () => {
  for (const error of [
    new Error('native configuration read failed'),
    new ProtocolError('timeout', 'remote deadline reached', 'unknown'),
    new ProtocolError('cancelled', 'remote cancellation outcome unknown', 'unknown'),
  ]) {
    const f = make();
    let rejectRead,
      calls = 0;
    f.client.readRepository = async () => {
      calls++;
      if (calls > 1) throw error;
      return new Promise((_ok, reject) => {
        rejectRead = reject;
      });
    };
    try {
      const pending = f.adapter.repository.context('repo');
      f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
      rejectRead(error);
      await assert.rejects(pending, (e) => e === error);
      assert.equal(calls, 1, 'an actual backend failure was reissued');
    } finally {
      f.adapter.dispose();
    }
  }
});

test('a refreshed live read retains the original parameters even if the caller edits its object', async () => {
  const f = make(),
    counts = [],
    params = { count: 5 };
  f.client.readRepository = async (_ref, _kind, p, { signal }) => {
    counts.push(p.count);
    if (counts.length === 1)
      return new Promise((_ok, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new ProtocolError('cancelled', 'Task cancelled', 'completed')),
          { once: true },
        ),
      );
    return { commits: [] };
  };
  try {
    const read = f.adapter.repository.log('repo', params);
    params.count = 50;
    f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
    await read;
    assert.deepEqual(counts, [5, 5]);
  } finally {
    f.adapter.dispose();
  }
});

test('an owning-resource invalidation refreshes even before its event; history conflicts and unknown outcomes stay visible', async () => {
  for (const scenario of [
    {
      detail: { code: 'READ_INVALIDATED', resourceId: 'resource' },
      observe: true,
      outcome: 'not-started',
      refresh: true,
    },
    { detail: { code: 'HISTORY_CHANGED' }, observe: true, outcome: 'not-started', refresh: false },
    {
      detail: { code: 'READ_INVALIDATED', resourceId: 'other' },
      observe: true,
      outcome: 'not-started',
      refresh: false,
    },
    {
      detail: { code: 'READ_INVALIDATED', resourceId: 'resource' },
      observe: false,
      outcome: 'not-started',
      refresh: true,
    },
    {
      detail: { code: 'READ_INVALIDATED', resourceId: 'resource' },
      observe: true,
      outcome: 'unknown',
      refresh: false,
    },
  ]) {
    const f = make();
    let rejectRead,
      calls = 0;
    const failure = new ProtocolError(
      'conflict',
      'Repository changed during read',
      scenario.outcome,
      scenario.detail,
    );
    f.client.readRepository = async () => {
      calls++;
      if (calls === 1)
        return new Promise((_ok, reject) => {
          rejectRead = reject;
        });
      if (!scenario.refresh) throw failure;
      return { verified: true };
    };
    try {
      const pending = f.adapter.git.signatures('repo', ['a'.repeat(40)]);
      if (scenario.observe)
        f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
      rejectRead(failure);
      if (scenario.refresh) assert.deepEqual(await pending, { verified: true });
      else await assert.rejects(pending, (e) => e === failure);
      assert.equal(calls, scenario.refresh ? 2 : 1);
    } finally {
      f.adapter.dispose();
    }
  }
});

test('a pinned Diff never refreshes automatically even when the owning Agent marks its read invalidated', async () => {
  const f = make();
  let calls = 0;
  const error = new ProtocolError('conflict', 'Repository changed during read', 'not-started', {
    code: 'READ_INVALIDATED',
    resourceId: resource.resourceId,
  });
  f.client.readRepository = async () => {
    calls++;
    f.events.forEach((fn) => fn({ type: 'repositories.changed', resource }));
    throw error;
  };
  try {
    await assert.rejects(
      f.adapter.repository.diff('repo', { file: 'tracked.txt' }),
      (e) => e === error,
    );
    assert.equal(calls, 1);
  } finally {
    f.adapter.dispose();
  }
});

test('unmapped file writes fail closed without executing any client method', async () => {
  const client = new Proxy(
    {},
    {
      get() {
        throw new Error('unexpected dispatch');
      },
    },
  );
  const write = createAgentFileWrite(client, () => undefined);
  await assert.rejects(write('ssh-host', '/outside/file', 'data'), /尚未绑定 Agent/);
});
test('unmapped analytics fail closed rather than mixing executors', async () => {
  const f = make();
  await assert.rejects(f.adapter.repository.analytics(['repo', 'other']), /尚未绑定 Agent/);
  assert.deepEqual(f.calls, []);
  f.adapter.dispose();
});
