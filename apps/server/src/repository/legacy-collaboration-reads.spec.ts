import { legacyCollaborationReads } from './legacy-collaboration-reads';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStateKernel } from '@alune/agent/state-kernel';
import type { HandlerContext } from '@alune/agent';
const {
  createRepository,
} = require('../../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const {
  connectFixture,
} = require('../../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

it('runs scoped reads over the legacy SSH channel and displays an offline source after rebinding', async () => {
  const f = createRepository();
  const ssh = await connectFixture(f);
  const agentId = randomUUID(),
    id = randomUUID(),
    host = randomUUID();
  const registration = { source: 'ssh', path: f.repo, connectionId: host };
  let stored = registration;
  const bridge = legacyCollaborationReads(
    { get: async () => stored } as any,
    { ensureConnected: async () => ssh.connection } as any,
  );
  const kernel = await openStateKernel(
    join(f.root, 'state'),
    agentId,
    undefined,
    { backend: 'file' },
    bridge,
  );
  try {
    const db = kernel.state.database;
    db.prepare(
      "INSERT INTO connections (id,name,host,port,username,auth_type,created_at,updated_at) VALUES (?, 'fixture','loopback',22,'fixture','password','now','now')",
    ).run(host);
    db.prepare(
      "INSERT INTO repositories (id,name,source,connection_id,path,created_at) VALUES (?,'repo','ssh',?,?,'now')",
    ).run(id, host, f.repo);
    f.git(
      'remote',
      'add',
      'origin',
      'https://git.fixture.invalid/group/team.git',
    );
    const signal = new AbortController().signal;
    const ctx = { agentId, signal, sessionSignal: signal } as HandlerContext;
    const discover = () =>
      kernel.handlers['catalog.reviews.sources'].run(
        { input: {} },
        ctx,
      ) as Promise<any>;
    const first = await discover();
    expect(first.sources[0]).toMatchObject({
      resource: { agentId, resourceId: id },
      availability: 'available',
      remote: { host: 'git.fixture.invalid' },
    });
    f.write('tracked.txt', 'staged-only');
    f.git('add', 'tracked.txt');
    f.write('tracked.txt', 'never-send-unstaged');
    const row = {
      ...registration,
      source: 'ssh' as const,
      id,
      name: 'repo',
      pinned: false,
      resource: { agentId, resourceId: id },
    };
    const staged = await bridge.openStaged(row, signal);
    try {
      const snapshot = await staged.staged.read(signal);
      expect(snapshot.diff).toContain('staged-only');
      expect(snapshot.diff).not.toContain('never-send-unstaged');
    } finally {
      await staged.release();
    }
    expect((await bridge.branch(row, undefined, signal)).sha).toBe(
      f.git('rev-parse', 'HEAD').trim(),
    );
    stored = { ...registration, path: f.root };
    const offline = await discover();
    expect(offline.sources[0]).toMatchObject({
      availability: 'offline',
      status: 'error',
      remote: null,
    });
  } finally {
    await kernel.close();
    await ssh.close();
    f.close();
  }
}, 30_000);
