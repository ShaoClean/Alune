// Exercises the actual Vite/WS/private-process boundary, not a supplied API mock.
// Run after building Agent and the UI (test:agent-dev workspace script).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { createServer } from 'vite';
import { AgentClient, frameTransport } from '@alune/agent-client';
test('Web development requires a local invitation and rejects other origins; a reopened tab sees the same Git state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alune-web-gateway-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const previous = process.env.ALUNE_AGENT_DATA_DIR;
  process.env.ALUNE_AGENT_DATA_DIR = join(directory, 'data');
  let invite = '';
  const log = (message) => {
    const found = message.match(/#alune-session=([a-f0-9]{64})/);
    if (found) invite = found[1];
  };
  const server = await createServer({
    root,
    mode: 'agent',
    customLogger: {
      info: log,
      warn: log,
      warnOnce: log,
      error: log,
      clearScreen() {},
      hasWarned: false,
      hasErrorLogged() {
        return false;
      },
    },
    server: { host: '127.0.0.1', port: 0 },
  });
  const clients = [];
  try {
    await server.listen();
    const port = server.httpServer.address().port,
      origin = 'http://127.0.0.1:' + port;
    async function socket(role, token, from) {
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket(
          'ws://127.0.0.1:' + port + '/__alune_agent/' + role,
          'alune.' + token,
          { origin: from, handshakeTimeout: 5000 },
        );
        ws.once('error', reject);
        ws.once('open', () => resolve(ws));
      });
    }
    assert.equal(invite.length, 64);
    await assert.rejects(socket('workspace', 'incorrect', origin));
    await assert.rejects(socket('workspace', invite, 'https://foreign.invalid'));
    async function open(role) {
      const ws = await socket(role, invite, origin);
      const c = new AgentClient(
        frameTransport({
          send: (frame) =>
            new Promise((resolve, reject) => ws.send(frame, (e) => (e ? reject(e) : resolve()))),
          close: () => ws.close(),
          onFrame(fn) {
            const read = (x) => fn(x.toString());
            ws.on('message', read);
            return () => ws.off('message', read);
          },
          onEnd(fn) {
            ws.on('close', fn);
            return () => ws.off('close', fn);
          },
        }),
      );
      clients.push(c);
      await c.initialize();
      return c;
    }
    const repo = join(directory, 'repo');
    await mkdir(repo);
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(join(repo, 'proof.txt'), 'web');
    const a = await open('workspace'),
      r = await a.registerRepository(repo);
    a.close();
    const b = await open('workspace');
    assert.equal(b.initialized.agentId, r.resource.agentId);
    assert.ok(
      (await b.readRepository(r.resource, 'status', {})).files.some((f) => f.path === 'proof.txt'),
    );
    const logs = await open('logs');
    await assert.rejects(logs.registerRepository(repo), (e) => e.kind === 'unknown-method');
  } finally {
    for (const c of clients) c.close();
    await server.close();
    if (previous === undefined) delete process.env.ALUNE_AGENT_DATA_DIR;
    else process.env.ALUNE_AGENT_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
});
