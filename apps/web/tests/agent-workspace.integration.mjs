import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadIdentity } from '../../../packages/agent/dist/adapters/identity.js';
import { AgentState } from '../../../packages/agent/dist/adapters/sqlite/state.js';
import { settingsKernel } from '../../../packages/agent/dist/bootstrap/settings-kernel.js';
import { RepositoryCatalog } from '../../../packages/agent/dist/modules/repositories/catalog.js';
import { superviseUiAgent, AgentClient, frameTransport } from '@alune/agent-client/node';
import { installWorkspaceAgent, readConnectedHead } from '../src/api/agent-workspace.ts';
import { repositoryApi, connectionApi, gitApi } from '../src/api/index.ts';
import { registerTerminalRemovalConfirmation } from '../src/stores/terminalRemoval.ts';
import { repositoryFileStatus, repositoryHistoryChanged } from '../src/api/repository-errors.ts';
import { workspaceTopics } from '../src/api/ui-agent.ts';
const root = fileURLToPath(new URL('../../..', import.meta.url));
test('UI facade keeps mixed-host analytics, Git writes, Worktree aliases, terminal consent and host deletion consistent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alune-ui-ops-')),
    state = join(dir, 'state'),
    repo = join(dir, 'repo');
  const entry = join(root, 'packages/agent/bin/alune-agent.cjs');
  let host, client;
  try {
    mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git('init', '-qb', 'main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    writeFileSync(join(repo, 'example.txt'), 'base\n');
    git('add', 'example.txt');
    git('commit', '-qm', 'base');
    writeFileSync(join(repo, 'example.txt'), 'edited\n');
    const agentId = await loadIdentity(state);
    const agentState = await AgentState.open(state, agentId);
    let hostId, localId, remoteId;
    const settings = settingsKernel(agentState, state, agentId);
    try {
      const { hosts: [offline] } = settings.hosts.save(null, {
        name: 'Offline host',
        host: 'fixture.invalid',
        port: 22,
        username: 'fixture',
        authType: 'sshAgent',
        privateKeyPath: null,
      }, settings.hosts.list().revision);
      hostId = offline.id;
      const catalog = new RepositoryCatalog(agentState.database, agentId);
      localId = catalog.register(repo, 'Local', 'main').id;
      const resourceId = randomUUID();
      remoteId = catalog.bindHost(hostId, {
        id: resourceId,
        resource: { agentId: randomUUID(), resourceId },
        source: 'local',
        name: 'Remote',
        path: '/fixture',
        worktreeKind: 'main',
      }, false).id;
    } finally {
      await settings.close();
      await agentState.close();
    }
    host = await superviseUiAgent(
      process.execPath,
      entry,
      state,
      JSON.parse(readFileSync(join(root, 'package.json'))).version,
    );
    client = new AgentClient(frameTransport(await host.open('workspace')));
    await client.initialize();
    await client.subscribe(workspaceTopics);
    await installWorkspaceAgent(client);
    const signal = new AbortController().signal;
    assert.deepEqual(await readConnectedHead(localId, undefined, signal), { kind: 'branch', name: 'main' });
    assert.equal(await readConnectedHead(remoteId, hostId, signal), null);
    const [offline] = await connectionApi.list();
    assert.equal(offline.status, 'unknown');
    assert.equal(offline.hasAuth, false);
    assert.deepEqual(await connectionApi.get(hostId), offline);
    await assert.rejects(connectionApi.get(randomUUID()), { kind: 'not-found' });
    const signing = await gitApi.signingConfig(localId);
    assert.equal(signing.source, 'local');
    assert.equal((await gitApi.saveSigningConfig(localId, signing)).source, 'local');
    const batch = await repositoryApi.analytics([remoteId, localId], true, true);
    assert.deepEqual(
      batch.map((r) => r.id),
      [remoteId, localId],
    );
    assert.ok(batch[0].error);
    assert.ok(batch[1].data);
    assert.match(await repositoryApi.diff(localId, { file: 'example.txt' }), /edited/);
    await gitApi.stage(localId, ['example.txt']);
    assert.equal(git('show', ':example.txt'), 'edited\n');
    await gitApi.commit(localId, 'through-ui');
    assert.equal(git('log', '-1', '--format=%s').trim(), 'through-ui');
    // A stale continuation needs a history reset. A missing image side on
    // an added/deleted file is an ordinary absence rather than a load error.
    const head = git('rev-parse', 'HEAD').trim();
    assert.deepEqual(
      (await repositoryApi.log(localId, { search: head.slice(0, 10), file: 'absent.txt' })).commits,
      [],
    );
    assert.equal(
      (await repositoryApi.log(localId, { search: head.slice(0, 10), file: 'example.txt' }))
        .commits[0].hash,
      head,
    );
    const page = await repositoryApi.log(localId, { count: 1 });
    git('branch', 'revision-drift');
    await assert.rejects(
      repositoryApi.log(localId, { skip: 1, count: 1, revision: page.revision }),
      repositoryHistoryChanged,
    );
    await assert.rejects(
      repositoryApi.file(localId, 'gone.txt'),
      (e) => repositoryFileStatus(e) === 404,
    );
    await assert.rejects(
      repositoryApi.diffImage(localId, { file: 'added.png', side: 'before' }),
      (e) => repositoryFileStatus(e) === 404,
    );
    const linked = await gitApi.createWorktree(localId, join(dir, 'linked'), 'ui-worktree');
    assert.equal((await repositoryApi.context(linked.id)).source, 'local');
    const removed = await gitApi.removeWorktree(localId, linked.path);
    assert.ok(removed.removedIds.includes(linked.id));
    const session = randomUUID();
    await client.request('terminals.create', {
      requestId: session,
      resource: { agentId: client.initialized.agentId, resourceId: localId },
      cols: 80,
      rows: 24,
    });
    registerTerminalRemovalConfirmation(async (rows) => {
      assert.equal(rows[0].id, session);
      return false;
    });
    await assert.rejects(repositoryApi.delete(localId), /已取消/);
    assert.equal((await repositoryApi.get(localId)).id, localId);
    registerTerminalRemovalConfirmation(async (rows) => rows[0].id === session);
    await repositoryApi.delete(localId);
    assert.equal(git('show', 'HEAD:example.txt'), 'edited\n');
    await connectionApi.delete(hostId);
    assert.deepEqual(await connectionApi.list(), []);
    assert.deepEqual(await repositoryApi.list(), []);
  } finally {
    registerTerminalRemovalConfirmation();
    client?.close();
    await host?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
});
