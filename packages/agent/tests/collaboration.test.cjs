const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { spawnAgent } = require('@alune/agent-client/node');

test('stdio collaboration keeps staged data and credentials scoped; an ambiguous platform write cannot replay after restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p6-'));
  const repo = path.join(root, 'repo'),
    env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ALUNE_P6_FIXTURE: root,
    };
  fs.mkdirSync(repo);
  let child;
  t.after(async () => {
    await child?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' }).trim();
  const file = (name, body) => fs.writeFileSync(path.join(repo, name), body);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@invalid');
  file('tracked', 'base');
  git('add', 'tracked');
  git('commit', '-m', 'base');
  git('remote', 'add', 'origin', 'https://github.com/team/repo.git');
  git('remote', 'add', 'gitlab', 'https://gitlab.fixture.invalid/team/repo.git');
  file('tracked', 'STAGED_ONLY');
  git('add', 'tracked');
  file('tracked', 'PRIVATE_UNSTAGED');
  async function start() {
    child = spawnAgent(
      process.execPath,
      [
        '--require',
        path.join(__dirname, 'collaboration-provider.cjs'),
        path.join(__dirname, 'settings-fixture.cjs'),
        path.join(root, 'state'),
      ],
      { env },
    );
    await child.client.initialize();
    return child.client;
  }
  let client = await start();
  const { resource } = await client.registerRepository(repo);
  const call = (method, input) => client.collaboration(method, { resource, input });
  assert.deepEqual((await client.collaboration('workspace.groups', {})).groups[0].resources, [
    resource,
  ]);
  const discovery = await client.collaboration('catalog.reviews.sources', { input: {} });
  assert.deepEqual(discovery.sources[0].resource, resource);
  assert.equal(discovery.sources[0].availability, 'available');
  await assert.rejects(
    client.request('reviews.remotes', { resource: { ...resource, agentId: 'foreign' } }),
    { kind: 'not-found' },
  );
  const settings = await client.getAiSettings();
  const provider = settings.providers.find((p) => p.id === 'openai');
  const saved = await client.saveAiProvider(
    provider.id,
    {
      ...provider,
      enabled: true,
      baseUrl: 'https://ai.fixture.invalid/v1',
      apiKey: 'fixture-ai-secret',
      models: [{ name: 'fixture', id: 'fixture', enabled: true }],
    },
    settings.revision,
  );
  assert.ok(!JSON.stringify(saved).includes('fixture-ai-secret'));
  const { revision } = await client.saveCommitPreferences(
    { ...saved.commit, providerId: provider.id, modelId: 'fixture' },
    saved.revision,
  );
  const head = git('rev-parse', 'HEAD');
  assert.equal((await call('ai.generate', { revision })).message, 'fixture commit');
  assert.equal(git('show', ':tracked'), 'STAGED_ONLY');
  assert.equal(git('rev-parse', 'HEAD'), head);
  await assert.rejects(call('ai.generate', { revision: 'stale' }), { kind: 'conflict' });
  fs.writeFileSync(path.join(root, 'change-index'), 'yes');
  await assert.rejects(call('ai.generate', { revision }), { kind: 'conflict' });
  file('tracked', 'x'.repeat(99000));
  git('add', 'tracked');
  await assert.rejects(call('ai.generate', { revision }), { kind: 'overloaded' });

  const list = await client.listAccessTokens();
  const tokens = await client.saveAccessToken(null, {
    name: 'platform',
    value: 'fixture-review-secret',
    revision: list.revision,
  });
  const q = { remote: 'origin', target: 'https://github.com/team/repo', provider: 'github' };
  const bound = await call('reviews.applyToken', {
    ...q,
    tokenId: tokens.tokens[0].id,
    revision: tokens.revision,
  });
  assert.ok(!JSON.stringify(bound).includes('fixture-review-secret'));
  const detail = { ...q, number: 12 };
  const savedRemotes = () => client.collaboration('reviews.remotes', { resource });
  const selectionVersion = (await savedRemotes()).find((remote) => remote.name === 'origin')
    .selection.version;
  const activity = { ...detail, selectionVersion, page: 1, since: '2026-11-03T00:00:00Z' };
  assert.deepEqual(await call('reviews.activity', { ...activity, kind: 'comments' }), {
    entries: [{ id: '12', createdAt: '2026-11-04T00:00:00Z' }],
    hasMore: true,
  });
  assert.deepEqual(await call('reviews.activity', { ...activity, kind: 'reviews' }), {
    entries: [{ id: '14', createdAt: '2026-11-02T00:00:00Z', state: 'APPROVED' }],
    hasMore: false,
  });
  assert.throws(
    () => call('reviews.activity', { ...activity, kind: 'comments', token: 'temporary' }),
    { kind: 'invalid-params' },
  );
  await assert.rejects(
    call('reviews.activity', { ...activity, kind: 'comments', selectionVersion: 'stale' }),
    { kind: 'conflict' },
  );
  const merged = (await call('reviews.list', { ...q, state: 'all', page: 1 })).items[0];
  assert.equal(merged.state, 'merged');
  assert.equal(merged.mergedAt, '2026-11-05T00:00:00Z');

  const gitlabToken = await client.saveAccessToken(null, {
    name: 'GitLab',
    value: 'fixture-gitlab-secret',
    revision: bound.revision,
  });
  const gitlab = {
    remote: 'gitlab',
    target: 'https://gitlab.fixture.invalid/team/repo',
    provider: 'gitlab',
  };
  await call('reviews.applyToken', {
    ...gitlab,
    tokenId: gitlabToken.tokens.find((token) => token.name === 'GitLab').id,
    revision: gitlabToken.revision,
  });
  const gitlabActivity = {
    ...activity,
    ...gitlab,
    selectionVersion: (await savedRemotes()).find((remote) => remote.name === 'gitlab').selection
      .version,
  };
  assert.deepEqual(await call('reviews.activity', { ...gitlabActivity, kind: 'comments' }), {
    entries: [{ id: '21', createdAt: '2026-11-04T00:00:00Z' }],
    hasMore: false,
  });
  const approvals = await call('reviews.activity', { ...gitlabActivity, kind: 'approvals' });
  assert.deepEqual(approvals.entries, []);
  assert.match(approvals.approvalState, /^[a-f0-9]{64}$/);

  const actions = await call('reviews.actions', detail);
  const write = {
    ...detail,
    revision: actions.revision,
    body: 'hello',
    position: undefined, // ordinary comment submitted by the real form
    action: 'comment',
    operationId: randomUUID(),
  };
  assert.throws(() => call('reviews.mutate', { ...write, unexpectedField: undefined }), {
    kind: 'invalid-params',
  });
  await assert.rejects(call('reviews.mutate', write), { outcome: 'unknown' });
  await child.close();
  client = await start();
  assert.equal((await client.getTask({ taskId: write.operationId })).task.state, 'unknown');
  await assert.rejects(call('reviews.mutate', write), { kind: 'duplicate-request' });
  assert.equal(fs.readFileSync(path.join(root, 'dispatched'), 'utf8'), 'comment\n');
});
