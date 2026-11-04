const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AgentSession } = require('../dist');
const { ProtocolError, validateEmpty } = require('@alune/protocol');

class Wire {
  listener;
  closer;
  replies = new Map();
  onMessage(fn) {
    this.listener = fn;
    return () => {
      this.listener = undefined;
    };
  }
  onClose(fn) {
    this.closer = fn;
    return () => {
      this.closer = undefined;
    };
  }
  send(message) {
    this.replies.set(message.id, message);
    return Promise.resolve();
  }
  close(error) {
    this.closer?.(error);
  }
  async request(id, method, params) {
    this.listener({
      jsonrpc: '2.0',
      id: `test:${id}`,
      method,
      ...(params === undefined ? {} : { params }),
    });
    for (let n = 0; n < 100 && !this.replies.has(`test:${id}`); n++)
      await new Promise((r) => setTimeout(r, 1));
    const response = this.replies.get(`test:${id}`);
    assert(response);
    return response;
  }
}
test('minor 0 keeps core methods but cannot invoke minor 1 state handlers or receive unknown error kinds', async () => {
  for (const minor of [0, 1]) {
    const wire = new Wire();
    const session = new AgentSession(wire, {
      agentId: 'agent',
      version: 'fixture',
      handlers: {
        'state.feature': {
          minimumProtocolMinor: 1,
          effect: 'query',
          validate: validateEmpty,
          run: () => true,
        },
        'legacy.error': {
          effect: 'query',
          validate: validateEmpty,
          run() {
            throw new ProtocolError('conflict', 'Changed');
          },
        },
      },
    });
    try {
      const init = await wire.request(1, 'initialize', {
        protocol: { major: 1, minor },
        client: { name: 'compat', version: '1' },
      });
      assert.equal(init.result.protocol.minor, minor);
      assert.equal(init.result.capabilities.includes('state.feature'), minor === 1);
      assert.equal((await wire.request(2, 'agent.health')).result.status, 'ok');
      const feature = await wire.request(3, 'state.feature');
      if (minor) assert.equal(feature.result, true);
      else assert.equal(feature.error.data.kind, 'unknown-method');
      const error = await wire.request(4, 'legacy.error');
      assert.equal(error.error.data.kind, minor ? 'conflict' : 'internal');
      assert.equal(error.error.data.outcome, 'not-started');
    } finally {
      await session.close();
    }
  }
});
