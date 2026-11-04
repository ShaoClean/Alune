const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventQueue } = require('../dist');

test('bounded reliable queue blocks on ACK and rejects overload without dropping data', async () => {
  const sent = [];
  const queue = new EventQueue(
    'agent',
    'session',
    async (m) => {
      sent.push(m.params);
    },
    () => {},
    { bytes: 4096, messages: 3, ackMs: 1000 },
  );
  queue.subscribe(['*']);
  try {
    const a = queue.write('out', { n: 1 });
    const b = queue.write('out', { n: 2 });
    await assert.rejects(queue.write('out', { n: 3 }), (e) => e.kind === 'overloaded');
    assert.equal(sent.length, 1);
    assert(queue.bufferedBytes <= 4096);
    assert.equal(queue.bufferedMessages, 2);
    queue.ack(1);
    await a;
    assert.equal(sent.length, 2);
    queue.ack(1); // Duplicate ACK cannot acknowledge the next item.
    assert.equal(queue.bufferedMessages, 1);
    assert.throws(() => queue.ack(3), /in-flight/);
    queue.ack(2);
    await b;
    assert.equal(queue.bufferedBytes, 0);
  } finally {
    queue.close();
  }
});

test('state coalescing is bounded, owns payloads and announces resync', () => {
  const sent = [];
  const q = new EventQueue(
    'agent',
    'session',
    async (m) => {
      sent.push(m.params);
    },
    () => {},
    { bytes: 4096, messages: 4, ackMs: 1000 },
  );
  q.subscribe(['*']);
  try {
    q.notifyState('state', { value: -1 });
    for (let n = 0; n < 1000; n++) q.notifyState('state', { value: n });
    assert(q.bufferedMessages <= 4);
    assert(q.bufferedBytes <= 4096);
    q.ack(1);
    assert.equal(sent[1].type, 'events.resync-required');
    q.ack(2);
    assert.equal(sent[2].payload.value, 999);
    q.ack(3);
    const payload = { value: 1 };
    q.notifyState('state', payload);
    payload.value = 10;
    assert.equal(sent[3].payload.value, 1);
  } finally {
    q.close();
  }
});

test('cancelled queued reliable writes are removed; delivered writes keep ACK accounting', async () => {
  const q = new EventQueue(
    'agent',
    'session',
    async () => {},
    () => {},
    { bytes: 4096, messages: 4, ackMs: 1000 },
  );
  q.subscribe(['*']);
  try {
    const first = new AbortController();
    const a = q.write('out', {}, undefined, first.signal);
    const second = new AbortController();
    const b = q.write('out', {}, undefined, second.signal);
    second.abort();
    await assert.rejects(b, (e) => e.kind === 'cancelled' && e.outcome === 'not-started');
    first.abort();
    await assert.rejects(a, (e) => e.outcome === 'unknown');
    assert.equal(q.bufferedMessages, 1);
    q.ack(1);
    assert.equal(q.bufferedMessages, 0);
  } finally {
    q.close();
  }
});

test('missing ACK terminates stream instead of retaining data forever', async () => {
  let failure;
  const q = new EventQueue(
    'agent',
    'session',
    async () => {},
    (e) => {
      failure = e;
    },
    { bytes: 4096, messages: 3, ackMs: 20 },
  );
  q.subscribe(['*']);
  await assert.rejects(q.write('out', {}), (e) => e.kind === 'timeout');
  assert.equal(failure.kind, 'timeout');
  assert.equal(q.bufferedBytes, 0);
});
