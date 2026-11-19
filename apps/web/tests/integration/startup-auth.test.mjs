// Actual Vite + WebSocket + private Agent process, only disposable state.
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
import { PROTOCOL_VERSION } from '@alune/protocol';

test('startup development gateway enforces loopback invitation origin host and workspace roles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'alune-startup-auth-'));
  const previous = process.env.ALUNE_AGENT_DATA_DIR;
  const previousLegacy = process.env.ALUNE_AGENT_LEGACY_DIR;
  process.env.ALUNE_AGENT_DATA_DIR = join(directory, 'state');
  process.env.ALUNE_AGENT_LEGACY_DIR = join(directory, 'absent-legacy');
  let invite = '',
    server;
  const clients = [],
    sockets = [];
  const log = (message) => {
    const match = message.match(/#alune-session=([a-f0-9]{64})/);
    if (match) invite = match[1];
  };
  try {
    server = await createServer({
      root: fileURLToPath(new URL('../../', import.meta.url)),
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
      server: { port: 0 },
    });
    assert.equal(server.config.server.host, '127.0.0.1');
    assert.equal(server.config.server.cors, false);
    assert.equal(server.config.server.proxy, undefined);
    await server.listen();
    const port = server.httpServer.address().port,
      origin = 'http://127.0.0.1:' + port;
    const connect = (role, { token = invite, from = origin, host } = {}) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(
          'ws://127.0.0.1:' + port + '/__alune_agent/' + role,
          token === null ? [] : ['alune.' + token],
          {
            ...(from === null ? {} : { origin: from }),
            ...(host ? { headers: { Host: host } } : {}),
            handshakeTimeout: 5000,
          },
        );
        sockets.push(ws);
        ws.once('error', reject);
        ws.once('open', () => resolve(ws));
      });
    assert.match(invite, /^[a-f0-9]{64}$/);
    for (const options of [
      { token: 'wrong' },
      { token: null },
      { from: null },
      { from: 'https://foreign.invalid' },
      { from: 'http://127.0.0.1:1' },
      { host: 'foreign.invalid', from: 'http://foreign.invalid' },
    ])
      await assert.rejects(connect('workspace', options));
    for (const role of ['native', 'workspace?role=native', 'logs/extra'])
      await assert.rejects(connect(role));
    const open = async (role) => {
      const ws = await connect(role);
      const c = new AgentClient(
        frameTransport({
          send: (frame) =>
            new Promise((resolve, reject) => ws.send(frame, (e) => (e ? reject(e) : resolve()))),
          close: () => ws.close(),
          onFrame(fn) {
            const read = (data) => fn(data.toString());
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
      return { c, ws };
    };
    const sequences = new WeakMap();
    const raw = (ws, method, params) =>
      new Promise((resolve, reject) => {
        const sequence = (sequences.get(ws) ?? 0) + 1;
        sequences.set(ws, sequence);
        const id = 'gateway:' + sequence;
        const timer = setTimeout(() => {
          ws.off('message', read);
          reject(Error('Missing raw gateway response'));
        }, 5000);
        const read = (data) => {
          const reply = JSON.parse(data.toString());
          if (reply.id !== id) return;
          clearTimeout(timer);
          ws.off('message', read);
          resolve(reply);
        };
        ws.on('message', read);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), (error) => {
          if (error) {
            clearTimeout(timer);
            ws.off('message', read);
            reject(error);
          }
        });
      });
    const a = await open('workspace'),
      logs = await open('logs');
    assert.equal((await a.c.request('agent.health')).status, 'ok');
    assert(Array.isArray(await logs.c.recentLogs(5)));
    // Separate raw peers use valid increasing IDs and never share an SDK session.
    const rawWorkspace = await connect('workspace'),
      rawLogs = await connect('logs');
    for (const ws of [rawWorkspace, rawLogs]) {
      const init = await raw(ws, 'initialize', {
        protocol: PROTOCOL_VERSION,
        client: { name: 'raw-dev-peer', version: '1' },
      });
      assert(init.result.capabilities.includes('agent.health'));
    }
    for (const method of ['network.updaterBridge', 'desktop.terminals.impact', 'storage.backup']) {
      const reply = await raw(rawWorkspace, method, {});
      assert.equal(reply.error.data.kind, 'unknown-method');
      assert.equal(reply.error.data.outcome, 'not-started');
    }
    const repo = join(directory, 'repo');
    await mkdir(repo);
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(join(repo, 'proof.txt'), 'gateway fixture');
    const { resource } = await a.c.registerRepository(repo);
    const denied = await raw(rawLogs, 'repositories.register', { path: repo });
    assert.equal(denied.error.data.kind, 'unknown-method');
    a.c.close();
    const b = await open('workspace');
    assert.equal(b.c.initialized.agentId, resource.agentId);
    assert.notEqual(b.c.initialized.sessionId, a.c.initialized.sessionId);
    assert(
      (await b.c.readRepository(resource, 'status', {})).files.some((f) => f.path === 'proof.txt'),
    );
    assert.equal(
      (await raw(rawWorkspace, 'agent.health', { role: 'native', token: invite })).error.data.kind,
      'invalid-params',
    );
  } finally {
    for (const c of clients) c.close();
    for (const ws of sockets) ws.terminate();
    await server?.close();
    if (previous === undefined) delete process.env.ALUNE_AGENT_DATA_DIR;
    else process.env.ALUNE_AGENT_DATA_DIR = previous;
    if (previousLegacy === undefined) delete process.env.ALUNE_AGENT_LEGACY_DIR;
    else process.env.ALUNE_AGENT_LEGACY_DIR = previousLegacy;
    await rm(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
  }
});
