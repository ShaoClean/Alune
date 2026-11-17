import assert from 'node:assert/strict';
import { AgentClient } from '@alune/agent-client';
import { agentOwners } from '../../apps/web/src/api/agent-workspace.ts';
import { remoteIdentity } from './p0-client-more-cases.mjs';
import { normalizeOperation } from './p0-client-oracle.mjs';
export { uuidV4 } from './p0-client-oracle.mjs';
export function harness(signal) {
  const client = new AgentClient({ onMessage: () => () => {}, onClose: () => () => {}, close() {}, send() { throw Error('Local transport must not execute'); } });
  client.identity = { agentId: 'local-agent' };
  const previousRequest = AgentClient.prototype.request;
  let queue = [], count = 0, cleanup = false;
  const mismatches = [], remotes = new Set(), state = {};
  let opened = false, initialized = false, receive, pollSignal;
  const dispatch = async function(method, params, options) {
    const host = this.initialized?.agentId;
    if (this !== client) remotes.add(this);
    try {
      // Actual openRemoteAgent initialization uses send(), not request(). Bridge
      // only this bootstrap at the local request boundary; all later remote
      // serializers/decoders execute into the same strict per-host request mock.
      if (host === 'local-agent' && method === 'hosts.receive') {
        assert.equal(opened, true);
        assert.deepEqual(params, { routeId: 'route-1' });
        assert.equal(options.timeoutMs, 30000);
        assert.ok(options.signal instanceof AbortSignal);
        pollSignal = options.signal;
        return await new Promise((resolve, reject) => {
          receive = resolve;
          const stop = () => reject(new Error('fixture route closed'));
          if (pollSignal.aborted) stop(); else pollSignal.addEventListener('abort', stop, { once: true });
        });
      }
      if (host === 'local-agent' && method === 'hosts.send') {
        assert.equal(opened, true); assert.equal(initialized, false);
        assert.deepEqual(Object.keys(params).sort(), ['message', 'routeId']);
        assert.equal(params.routeId, 'route-1');
        const message = params.message;
        assert.match(message.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:1$/);
        assert.deepEqual({ ...message, id: '$requestId' }, { jsonrpc: '2.0', id: '$requestId', method: 'initialize', params: { protocol: { major: 1, minor: 7 }, client: { name: 'alune-client', version: '0.0.1' } } });
        assert.deepEqual(options, { signal: pollSignal });
        initialized = true;
        assert.equal(typeof receive, 'function');
        receive({ jsonrpc: '2.0', id: message.id, result: structuredClone(remoteIdentity) });
        return {};
      }
      if (host === 'local-agent' && method === 'hosts.disconnect' && cleanup) {
        assert.deepEqual(params, { routeId: 'route-1' });
        assert.deepEqual(options, { timeoutMs: 5000 });
        return {};
      }
      const expected = queue.shift(); count++;
      assert.ok(expected, 'Unexpected ' + host + ' RPC ' + method);
      assert.equal(host, expected.host);
      assert.equal(method, expected.method);
      assert.deepEqual(normalizeOperation(params, expected.params, state), expected.params);
      let actualOptions = options;
      if (expected.options?.signal === '$signal') {
        assert.equal(options.signal, signal, 'caller AbortSignal identity');
        actualOptions = { ...options, signal: '$signal' };
      } else if (expected.options?.signal === '$liveSignal') {
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.signal.aborted, false);
        actualOptions = { ...options, signal: '$liveSignal' };
      }
      assert.deepEqual(actualOptions, expected.options);
      if (expected.error) throw expected.error;
      if (method === 'hosts.open') { assert.equal(opened, false); opened = true; }
      const response = structuredClone(expected.response);
      // A fixture server echoes only the validated operation ID into a task
      // receipt. This does not change the independent request oracle.
      if (response?.task?.taskId === '$operationId') {
        assert.ok(state.operationId);
        response.task.taskId = state.operationId;
      }
      return response;
    } catch (error) {
      // Injected failures are intentional; assertion errors must never be hidden
      // by product catch/recovery logic or counted as successful expectations.
      if (error?.code === 'ERR_ASSERTION') mismatches.push(error);
      throw error;
    }
  };
  AgentClient.prototype.request = dispatch;
  client.request = dispatch.bind(client);
  return { client,
    expect(requests) { assert.equal(queue.length, 0); queue = [...requests]; },
    done() {
      assert.equal(queue.length, 0, 'Every expected RPC must execute');
      if (mismatches.length) throw mismatches[0];
      assert.equal(client.state, 'ready', 'valid responses must not silently close the client');
      for (const remote of remotes) assert.equal(remote.state, 'ready');
    },
    count: () => count,
    operationId: () => state.operationId,
    close() {
      cleanup = true;
      for (const remote of remotes) { remote.close(); agentOwners.delete(remote); }
      client.close(); agentOwners.delete(client);
      AgentClient.prototype.request = previousRequest;
      if (mismatches.length) throw mismatches[0];
    },
  };
}
