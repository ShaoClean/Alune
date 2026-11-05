import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRepositoryQueries } from '../src/api/agent-repositories.ts';
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
    async status() {
      return 'legacy status';
    },
  };
  const git = {
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
