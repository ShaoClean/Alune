const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  parseMessage,
  encodeMessage,
  parseEvent,
  validateInitialize,
  validateInitialized,
  validateEmpty,
  ProtocolError,
  ERROR_CODES,
  MAX_FRAME_BYTES,
} = require('../dist');

const request = { jsonrpc: '2.0', id: 'request:1', method: 'agent.health', params: {} };
test('request, notification, result and structured errors round-trip as one NDJSON frame', () => {
  for (const message of [
    request,
    { jsonrpc: '2.0', method: '$/cancelRequest', params: { requestId: 'request:1' } },
    { jsonrpc: '2.0', id: 'request:1', result: { text: '中文\nvalue' } },
    { jsonrpc: '2.0', id: null, error: new ProtocolError('parse', 'Bad JSON').toRpcError() },
    {
      jsonrpc: '2.0',
      id: 'request:1',
      error: new ProtocolError('disconnected', 'Lost', 'unknown').toRpcError(),
    },
  ]) {
    const wire = encodeMessage(message);
    assert.equal(wire.split('\n').length, 2);
    assert.deepEqual(parseMessage(wire), message);
  }
});

test('rejects ambiguous envelopes, invalid IDs and non-JSON numbers before dispatch', () => {
  const invalid = [
    [],
    null,
    {},
    { ...request, id: 1 },
    { ...request, id: '' },
    { ...request, id: 'x\n' },
    { ...request, result: true },
    { ...request, method: '' },
    { jsonrpc: '2.0', id: 'x', result: 1, error: {} },
    { jsonrpc: '2.0', id: null, result: 1 },
    {
      jsonrpc: '2.0',
      id: 'x',
      error: { code: -32603, message: 'x', data: { kind: 'constructor', outcome: 'unknown' } },
    },
  ];
  for (const value of invalid)
    assert.throws(() => parseMessage(JSON.stringify(value)), ProtocolError);
  assert.throws(
    () => parseMessage('{'),
    (e) => e.kind === 'parse',
  );
  assert.throws(() => parseMessage('{"jsonrpc":"2.0","id":"x","result":1e400}'), ProtocolError);
  assert.throws(() => encodeMessage({ jsonrpc: '2.0', id: 'x', result: Infinity }), ProtocolError);
  assert.throws(() => encodeMessage({ jsonrpc: '2.0', id: 'x', result: undefined }), ProtocolError);
});

test('frame limit counts UTF-8 bytes and recursive payloads have a depth bound', () => {
  assert.throws(
    () =>
      parseMessage(
        JSON.stringify({ ...request, params: '中'.repeat(Math.ceil(MAX_FRAME_BYTES / 3)) }),
      ),
    (e) => e.kind === 'invalid-request',
  );
  let nested = {};
  for (let i = 0; i < 66; i++) nested = { next: nested };
  assert.throws(() => parseMessage(JSON.stringify({ ...request, params: nested })), ProtocolError);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => encodeMessage({ ...request, params: cycle }), ProtocolError);
});

test('handshake rejects incompatible major, malformed minor, and invalid server identity', () => {
  const init = { protocol: { major: 1, minor: 7 }, client: { name: 'test', version: '1' } };
  assert.deepEqual(validateInitialize(init), init);
  assert.throws(
    () => validateInitialize({ ...init, protocol: { major: 2, minor: 0 } }),
    (e) => e.toRpcError().code === ERROR_CODES['incompatible-version'],
  );
  for (const minor of [-1, 0.5, null, '0'])
    assert.throws(
      () => validateInitialize({ ...init, protocol: { major: 1, minor } }),
      ProtocolError,
    );
  assert.throws(
    () => validateInitialize({ ...init, client: { name: ' ', version: '1' } }),
    ProtocolError,
  );
  const response = {
    protocol: { major: 1, minor: 0 },
    agentId: 'agent:1',
    sessionId: 'session:1',
    implementation: { name: 'Alune', version: '1' },
    capabilities: ['agent.health'],
    lifecycle: 'session',
  };
  assert.deepEqual(validateInitialized(response), response);
  assert.throws(() => validateInitialized({ ...response, lifecycle: 'daemon' }), ProtocolError);
  assert.throws(() => validateInitialized({ ...response, agentId: '../host' }), ProtocolError);
  validateEmpty(undefined);
  validateEmpty({});
  for (const params of [null, [], { extra: true }])
    assert.throws(() => validateEmpty(params), ProtocolError);
});

test('events require host/session sequence and cannot attach another host resource', () => {
  const event = {
    agentId: 'host-a',
    sessionId: 'session-a',
    sequence: 1,
    type: 'repository.changed',
    resource: { agentId: 'host-a', resourceId: 'repo-a' },
    payload: {},
  };
  assert.deepEqual(parseEvent(event), event);
  for (const value of [
    { ...event, sequence: 0 },
    { ...event, sequence: 1.5 },
    { ...event, resource: { agentId: 'host-b', resourceId: 'repo-a' } },
    { ...event, payload: undefined },
  ])
    assert.throws(() => parseEvent(value), ProtocolError);
});
