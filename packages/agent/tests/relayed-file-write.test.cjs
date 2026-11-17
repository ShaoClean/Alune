const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { AgentSession } = require('../dist');
const { HostRelay } = require('../dist/modules/hosts/relay');
const { workspaceRemoval } = require('../dist/bootstrap/workspace-removal');
const { PROTOCOL_VERSION, validateEmpty } = require('@alune/protocol');
const { until } = require('./terminal-scenario.cjs');

test('a relayed file write blocks host removal until its terminal reply, without replay', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alune-relayed-file-write-'));
  const sides = [0, 1].map(() => ({ messages: new Set(), closers: new Set() }));
  let closed = false;
  const sent = [];
  const wire = (index) => ({
    async send(message) {
      if (closed) throw new Error('Fixture closed');
      if (!index) sent.push(message);
      for (const receive of sides[1 - index].messages) receive(message);
    },
    onMessage(fn) {
      sides[index].messages.add(fn);
      return () => sides[index].messages.delete(fn);
    },
    onClose(fn) {
      sides[index].closers.add(fn);
      return () => sides[index].closers.delete(fn);
    },
    close(error) {
      if (closed) return;
      closed = true;
      for (const side of sides) for (const close of side.closers) close(error);
    },
  });
  let release,
    writes = 0,
    initialized = false,
    removed = 0,
    invalidated = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const noop = { effect: 'query', validate: validateEmpty, run: () => null };
  const remote = new AgentSession(wire(1), {
    agentId: 'remote-agent',
    version: 'fixture',
    handlers: {
      ...Object.fromEntries(
        [
          'repositories.list',
          'repositories.write',
          'terminals.create',
          'reviews.list',
          'repositories.hostRead',
        ].map((name) => [name, noop]),
      ),
      'files.write': {
        minimumProtocolMinor: 7,
        effect: 'mutation',
        validate: validateEmpty,
        async run() {
          await fs.writeFile(path.join(directory, 'outside.txt'), 'one remote file write\n');
          writes++;
          await gate;
          return { success: true };
        },
      },
    },
  });
  const relay = new HostRelay(
    wire(0),
    'fixture',
    () => {
      initialized = true;
    },
    () => {},
    () => {},
    () => {},
  );
  const removal = workspaceRemoval(
    { catalog: { list: () => [] } },
    {
      remoteTerminals: () => [],
      activeWrites: () => relay.pendingWrites.map((w) => ({ ...w, hostId: 'host' })),
      forget: () => {
        invalidated++;
      },
    },
    {
      hosts: {
        delete: () => {
          removed++;
        },
      },
    },
  );
  const input = { kind: 'host', id: 'host', revision: 'revision', repositories: [], sessions: [] };
  const context = { agentId: 'local-agent', events: { notifyState() {} } };
  try {
    await relay.send({
      jsonrpc: '2.0',
      id: 'client:1',
      method: 'initialize',
      params: { protocol: PROTOCOL_VERSION, client: { name: 'write-impact', version: 'fixture' } },
    });
    await until(() => initialized, 'remote handshake');
    await relay.send({ jsonrpc: '2.0', id: 'client:2', method: 'files.write', params: {} });
    await until(() => writes === 1, 'actual file write reached its delivery barrier');
    assert.equal(
      await fs.readFile(path.join(directory, 'outside.txt'), 'utf8'),
      'one remote file write\n',
    );
    removal.validate(input);
    assert.throws(
      () => removal.run(input, context),
      (e) => e.kind === 'busy',
    );
    assert.equal(removed, 0);
    assert.equal(invalidated, 0);
    release();
    await until(() => relay.pendingWrites.length === 0, 'terminal write reply');
    assert.deepEqual(removal.run(input, context), { removedIds: [] });
    assert.equal(removed, 1);
    assert.equal(invalidated, 1);
    assert.equal(sent.filter((m) => m.method === 'files.write').length, 1);
    assert.equal(writes, 1);
  } finally {
    release();
    relay.close();
    await remote.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
