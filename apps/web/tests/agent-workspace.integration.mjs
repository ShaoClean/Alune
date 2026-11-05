import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { superviseUiAgent, AgentClient, frameTransport } from '@alune/agent-client/node';
import { installWorkspaceAgent } from '../src/api/agent-workspace.ts';
import { repositoryApi, connectionApi, gitApi } from '../src/api/index.ts';
import { registerTerminalRemovalConfirmation } from '../src/stores/terminalRemoval.ts';
import { workspaceTopics } from '../src/api/ui-agent.ts';
const root = fileURLToPath(new URL('../../..', import.meta.url));
test('UI facade keeps mixed-host analytics, Git writes, Worktree aliases, terminal consent and host deletion consistent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alune-ui-ops-')),
    source = join(dir, 'legacy'),
    state = join(dir, 'state'),
    repo = join(dir, 'repo');
  const entry = join(root, 'packages/agent/bin/alune-agent.cjs');
  let host, client;
  try {
    mkdirSync(source);
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
    const hostId = randomUUID(),
      localId = randomUUID(),
      remoteId = randomUUID(),
      now = new Date().toISOString();
    const db = new Database(join(source, 'alune.db'));
    try {
      db.exec(
        'CREATE TABLE connections(id TEXT PRIMARY KEY,name TEXT,host TEXT,port INTEGER,username TEXT,auth_type TEXT,password TEXT,private_key_path TEXT,passphrase TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE repositories(id TEXT PRIMARY KEY,connection_id TEXT,source TEXT,name TEXT,path TEXT,pinned INTEGER,created_at TEXT,worktree_kind TEXT);',
      );
      db.prepare(
        "INSERT INTO connections VALUES (?,'Offline host','fixture.invalid',22,'fixture','sshAgent',NULL,NULL,NULL,?,?)",
      ).run(hostId, now, now);
      const add = db.prepare("INSERT INTO repositories VALUES (?,?,?,?,?,0,?,'main')");
      add.run(localId, null, 'local', 'Local', repo, now);
      add.run(remoteId, hostId, 'ssh', 'Remote', '/fixture', now);
    } finally {
      db.close();
    }
    execFileSync(
      process.execPath,
      [entry, 'legacy-import', '--source', source, '--data-dir', state],
      { stdio: 'pipe' },
    );
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
    assert.equal((await connectionApi.list())[0].status, 'unknown');
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
