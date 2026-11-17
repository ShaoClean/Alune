// Shared by the working-tree tests and the standalone archive smoke.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const topics = ['terminal:state', 'terminal:output', 'terminal:removed'];
async function until(check, description) {
  const end = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out: ' + description);
    await delay(15);
  }
}
async function terminalScenario(client, resource, repo, whileRunning) {
  const run = (command, params) => client.request('terminals.' + command, params);
  const create = (requestId) => run('create', { resource, requestId, cols: 80, rows: 24 });
  const id = randomUUID(),
    second = randomUUID();
  const states = new Map(),
    output = new Map(),
    sequences = new Map(),
    removed = new Set(),
    closing = new Set(),
    pendingAcks = new Set();
  let hold = true,
    held,
    ackError;
  const off = client.onEvent(({ type, resource: source, payload: p }) => {
    if (!topics.includes(type)) return;
    assert.deepEqual(source, resource);
    if (type === 'terminal:state') states.set(p.id, p);
    if (type === 'terminal:removed') removed.add(p.sessionId);
    if (type === 'terminal:output') {
      assert.equal(p.sequence, (sequences.get(p.sessionId) ?? 0) + 1);
      assert(Buffer.byteLength(p.data) <= 16384);
      sequences.set(p.sessionId, p.sequence);
      output.set(p.sessionId, (output.get(p.sessionId) ?? '') + p.data);
      const packet = { sessionId: p.sessionId, sequence: p.sequence };
      if (hold && p.sessionId === id) held = packet;
      else if (!closing.has(p.sessionId)) {
        const ack = run('ack', packet).catch((e) => {
          ackError = e;
        });
        pendingAcks.add(ack);
        void ack.finally(() => pendingAcks.delete(ack));
      }
    }
  });
  try {
    await client.subscribe(topics);
    await assert.rejects(
      run('create', { resource, requestId: id, cols: 80, rows: 24, ownerId: 'fake' }),
      (e) => e.kind === 'invalid-params',
    );
    await Promise.all([create(id), create(second)]);
    await until(
      () => [id, second].every((k) => states.get(k)?.state === 'running'),
      'two real shells running',
    );
    assert.equal(states.get(id).initialPath, path.normalize(repo));
    assert.deepEqual(states.get(id).windowsPty, process.platform === 'win32'
      ? { backend: 'conpty', buildNumber: Number(require('node:os').release().split('.')[2]) }
      : undefined);
    if (whileRunning) await whileRunning([id, second]);
    await assert.rejects(
      run('close', { sessionId: id, confirmed: false }),
      (e) => e.kind === 'conflict',
    );
    const marker = randomUUID();
    fs.writeFileSync(
      path.join(repo, 'terminal-fixture.txt'),
      'first:' + marker + '\n' + 'x'.repeat(3100) + '\nlast:' + marker + '\n',
    );
    const read = (process.platform === 'win32' ? 'type' : 'cat') + ' terminal-fixture.txt\r';
    await run('input', { sessionId: id, data: read });
    await until(() => held, 'slow parser holds one shell');
    await run('resize', { sessionId: second, cols: 99, rows: 30 });
    await run('input', { sessionId: second, data: read });
    await until(
      () => output.get(second)?.includes('last:' + marker),
      'other shell independently drains',
    );
    assert.equal(sequences.get(id), 1);
    assert.equal((await run('list', {})).length, 2);
    await assert.rejects(
      run('ack', { ...held, sequence: held.sequence + 1 }),
      (e) => e.kind === 'conflict',
    );
    hold = false;
    await run('ack', held);
    await until(
      () => output.get(id)?.includes('last:' + marker),
      'held output is delivered in order',
    );
    assert(output.get(id).indexOf('first:' + marker) < output.get(id).indexOf('last:' + marker));
    await run('input', {
      sessionId: second,
      data: process.platform === 'win32' ? 'exit /b 7\r' : 'exit 7\r',
    });
    await until(() => states.get(second)?.exitCode === 7, 'terminal exit code');
    // Finish checking all ACKs issued for live sessions. A close releases
    // remaining output; later ACKs must not succeed or recreate the PTY.
    closing.add(second);
    closing.add(id);
    await Promise.all(pendingAcks);
    assert.ifError(ackError);
    await run('close', { sessionId: second, confirmed: false });
    await run('close', { sessionId: id, confirmed: true });
    await until(() => removed.size === 2, 'reliable removal events');
    await assert.rejects(run('ack', { sessionId: id, sequence: sequences.get(id) }), {
      kind: 'conflict',
    });
    assert.deepEqual(await run('list', {}), []);
  } finally {
    off();
    fs.rmSync(path.join(repo, 'terminal-fixture.txt'), { force: true });
  }
}
module.exports = { terminalScenario, until, topics };
