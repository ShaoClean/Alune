const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Writable } = require('node:stream');
const { StdioTransport } = require('../dist/node');
const { FrameDecoder, encodeMessage, parseMessage, MAX_FRAME_BYTES } = require('@alune/protocol');

test('framing handles byte-at-a-time Unicode and several messages in one chunk', () => {
  const decoder = new FrameDecoder();
  const received = [];
  const message = { jsonrpc: '2.0', id: 'x', result: '中文\ntext' };
  const bytes = Buffer.from(encodeMessage(message));
  for (const byte of bytes)
    decoder.push(Buffer.from([byte]), (frame) => received.push(parseMessage(frame)));
  decoder.push(Buffer.concat([bytes, bytes]), (frame) => received.push(parseMessage(frame)));
  decoder.end();
  assert.deepEqual(received, [message, message, message]);
});
test('framing rejects malformed UTF-8, incomplete EOF and oversize unterminated frames', () => {
  assert.throws(() => new FrameDecoder().push(Buffer.from([0xff, 10]), () => {}), /UTF-8/);
  const partial = new FrameDecoder();
  partial.push(Buffer.from('{'), () => {});
  assert.throws(() => partial.end(), /Truncated/);
  assert.throws(
    () => new FrameDecoder().push(Buffer.alloc(MAX_FRAME_BYTES + 1, 120), () => {}),
    /limit/,
  );
});
test('stdio outbox is bounded and rejects pending deliveries as unknown when interrupted', async () => {
  const input = new PassThrough();
  let flush;
  const output = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, done) {
      flush = done;
    },
  });
  const transport = new StdioTransport(input, output, { bytes: 1024, messages: 2 });
  const message = { jsonrpc: '2.0', id: 'x', result: 1 };
  const a = transport.send(message);
  const b = transport.send(message);
  await assert.rejects(
    transport.send(message),
    (e) => e.kind === 'overloaded' && e.outcome === 'not-started',
  );
  flush();
  await a;
  const rejected = assert.rejects(b, (e) => e.kind === 'disconnected' && e.outcome === 'unknown');
  transport.close();
  await rejected;
  flush();
});

test('closed peer pipes are disconnects while other stream failures stay errors', async () => {
  for (const code of ['EPIPE', 'ECONNRESET', 'EIO']) {
    const input = new PassThrough();
    const failure = Object.assign(new Error('synthetic pipe failure'), { code });
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(failure);
      },
    });
    const transport = new StdioTransport(input, output);
    let ended;
    transport.onClose((error) => {
      ended = error;
    });
    await assert.rejects(
      transport.send({ jsonrpc: '2.0', method: 'fixture', id: 'fixture:1' }),
      (error) => error.kind === 'disconnected' && error.outcome === 'unknown',
    );
    if (code === 'EIO') assert.equal(ended, failure);
    else {
      assert.equal(ended.kind, 'disconnected');
      assert.equal(ended.outcome, 'unknown');
    }
  }
});
