const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { AgentClient } = require('../dist/browser');

class Transport {
  sent = [];
  messages = new Set();
  closures = new Set();
  ended = false;
  send(message) {
    this.sent.push(message);
    return Promise.resolve();
  }
  onMessage(fn) {
    this.messages.add(fn);
    return () => this.messages.delete(fn);
  }
  onClose(fn) {
    this.closures.add(fn);
    return () => this.closures.delete(fn);
  }
  close(error = new Error('closed')) {
    if (this.ended) return;
    this.ended = true;
    for (const fn of this.closures) fn(error);
  }
  receive(message) {
    for (const fn of this.messages) fn(message);
  }
  respond(request, result) {
    this.receive({ jsonrpc: '2.0', id: request.id, result });
  }
}
async function fixture() {
  const transport = new Transport();
  const client = new AgentClient(transport);
  const init = client.initialize();
  transport.respond(transport.sent[0], {
    protocol: { major: 1, minor: 0 },
    agentId: 'agent',
    sessionId: 'session',
    implementation: { name: 'fixture', version: '1' },
    lifecycle: 'session',
    capabilities: ['echo', 'events.subscribe', 'agent.health'],
  });
  await init;
  return { transport, client };
}
test('correlates reverse-order replies and ignores only known duplicate responses', async () => {
  const { transport, client } = await fixture();
  try {
    const a = client.startRequest('echo', { value: 'a' });
    const b = client.startRequest('echo', { value: 'b' });
    assert.notEqual(a.requestId, b.requestId);
    transport.respond(transport.sent[2], 'b');
    transport.respond(transport.sent[1], 'a');
    assert.equal(await a.result, 'a');
    assert.equal(await b.result, 'b');
    transport.respond(transport.sent[1], 'duplicate');
    assert.equal(client.state, 'ready');
    const pending = client.request('echo');
    transport.receive({ jsonrpc: '2.0', id: 'alien', result: 'x' });
    await assert.rejects(pending, (e) => e.outcome === 'unknown');
    assert.equal(client.state, 'closed');
    await assert.rejects(client.initialize(), (e) => e.kind === 'disconnected');
  } finally {
    client.close();
  }
});
test('pre-cancel never sends; timeout cancels once and never replays the request', async () => {
  const { transport, client } = await fixture();
  try {
    const before = transport.sent.length;
    await assert.rejects(
      client.request('echo', {}, { signal: AbortSignal.abort() }),
      (e) => e.outcome === 'not-started',
    );
    assert.equal(transport.sent.length, before);
    const request = client.startRequest('echo', {}, { timeoutMs: 10 });
    await assert.rejects(request.result, (e) => e.kind === 'timeout' && e.outcome === 'unknown');
    assert.equal(transport.sent.filter((m) => m.id === request.requestId).length, 1);
    assert.equal(transport.sent.filter((m) => m.method === '$/cancelRequest').length, 1);
    transport.receive({ jsonrpc: '2.0', id: request.requestId, result: 'late' });
    assert.equal(client.state, 'ready');
    const unlimited = client.startRequest('echo', {}, { timeoutMs: null });
    await new Promise((resolve) => setTimeout(resolve, 25));
    transport.receive({ jsonrpc: '2.0', id: unlimited.requestId, result: 'ok' });
    assert.equal(await unlimited.result, 'ok');
  } finally {
    client.close();
  }
});
test('event ACK follows async consumption, duplicates are not redelivered, gaps close the connection', async () => {
  const { transport, client } = await fixture();
  try {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const seen = [];
    client.onEvent(async (event) => {
      seen.push(event.sequence);
      await gate;
    });
    const event = {
      agentId: 'agent',
      sessionId: 'session',
      sequence: 1,
      type: 'output',
      payload: 'text',
    };
    const notification = { jsonrpc: '2.0', method: 'agent.event', params: event };
    transport.receive(notification);
    transport.receive(notification);
    assert.deepEqual(seen, [1]);
    assert.equal(transport.sent.filter((m) => m.method === 'events.ack').length, 0);
    release();
    await delay(0);
    assert.equal(transport.sent.filter((m) => m.method === 'events.ack').length, 1);
    transport.receive(notification);
    await delay(0);
    assert.deepEqual(seen, [1]);
    assert.equal(transport.sent.filter((m) => m.method === 'events.ack').length, 2);
    transport.receive({ ...notification, params: { ...event, sequence: 3 } });
    assert.equal(client.state, 'closed');
  } finally {
    client.close();
  }
});
test('malicious fast events cannot grow the client queue without bound', async () => {
  const { transport, client } = await fixture();
  client.onEvent(() => new Promise(() => {}));
  for (let i = 1; i <= 1000; i++)
    transport.receive({
      jsonrpc: '2.0',
      method: 'agent.event',
      params: { agentId: 'agent', sessionId: 'session', sequence: i, type: 'output', payload: 'x' },
    });
  assert.equal(client.state, 'closed');
});

test('typed health response rejects a different Agent identity', async () => {
  const { transport, client } = await fixture();
  const pending = client.health();
  transport.respond(transport.sent.at(-1), {
    status: 'ok',
    agentId: 'another-host',
    sessionId: 'session',
    lifecycle: 'session',
  });
  await assert.rejects(pending, /another session/);
  assert.equal(client.state, 'closed');
});

test('incompatible server handshake closes once and never silently downgrades or retries', async () => {
  const transport = new Transport();
  const client = new AgentClient(transport);
  const init = client.initialize();
  transport.respond(transport.sent[0], {
    protocol: { major: 2, minor: 0 },
    agentId: 'agent',
    sessionId: 'session',
    implementation: { name: 'future', version: '2' },
    lifecycle: 'session',
    capabilities: [],
  });
  await assert.rejects(init, (e) => e.kind === 'incompatible-version');
  assert.equal(client.state, 'closed');
  assert.equal(transport.sent.length, 1);
});
