import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, uuidV4 } from './p0-client-harness.mjs';
import { fixedTime } from './p0-client-more-cases.mjs';
import { ProtocolError } from '@alune/protocol';
import { installWorkspaceAgent } from "../../../apps/web/src/api/agent-workspace.ts";
import { aiApi, aiError } from "../../../apps/web/src/api/ai.ts";
import { loggingApi, loggingError } from "../../../apps/web/src/api/logging.ts";
import { proxyApi, proxyError } from "../../../apps/web/src/api/proxy.ts";
import { repositoryApi, gitApi, accessTokenApi, pullRequestCenterApi, connectionApi, fileApi } from "../../../apps/web/src/api/index.ts";
import { cases, resource, alias } from './p0-client-cases.mjs';
const api = { ai: aiApi, logs: loggingApi, proxy: proxyApi, repo: repositoryApi, git: gitApi, accounts: accessTokenApi, center: pullRequestCenterApi, connections: connectionApi, files: fileApi };
const uninstalled = Object.fromEntries(Object.entries(api).map(([k,v]) => [k, { ...v }]));


for (const c of cases) test(c.testName, async (t) => {
  t.mock.method(Date, 'now', () => fixedTime);
  const signal = new AbortController().signal;
  await assert.rejects(() => c.invoke(uninstalled, signal), /Agent 尚未连接/);
  for (const mode of ['success', 'protocol-error', ...(c.writeKind ? ['prepare-error', 'unknown-write'] : [])]) {
    const h = harness(signal);
    try {
      await installWorkspaceAgent(h.client);
      for (const setup of c.setup) { h.expect(setup.requests); await setup.invoke(api, signal); h.done(); }
      if (mode === 'success') {
        h.expect(c.requests);
        assert.deepEqual(await c.invoke(api, signal), c.expected, 'public return projection');
      } else if (mode === 'unknown-write') {
        const at = c.requests.findIndex(r => r.method === 'repositories.write');
        const error = new ProtocolError('disconnected', 'response lost', 'unknown');
        const requests = c.requests.slice(0, at + 1).map((r,i) => i === at ? { ...r, error } : r);
        if (c.writeKind !== 'writeFile') requests.push({ host: 'local-agent', method: 'tasks.get', params: { taskId: '$operationId' }, response: { scope: 'agent', task: null }, options: undefined });
        h.expect(requests);
        await assert.rejects(() => c.invoke(api, signal), e => {
          assert.match(h.operationId(), uuidV4);
          assert.ok(e.message.includes(h.operationId()));
          const message = e.message.replace(h.operationId(), '$operationId');
          if (c.writeKind === 'writeFile') {
            assert.equal(e.cause, error);
            assert.equal(message, '文件写入结果未知（操作 $operationId），请查询状态并核对文件。');
          } else assert.equal(message, 'response lost（操作 $operationId；请刷新仓库核对结果，请勿重复执行。）');
          return true;
        });
      } else {
        const at = mode === 'prepare-error' ? c.requests.findIndex(r => r.method === 'repositories.prepareWrite')
          : c.errorAt ?? (c.requests[0].method === 'repositories.get' && c.requests.length > 1 ? 1 : 0);
        assert.ok(at >= 0);
        const error = new ProtocolError('conflict', 'fixture denied', 'not-started', { code: 'FIXTURE' });
        h.expect(c.requests.slice(0, c.failureTail ? c.requests.length : at + 1).map((r,i) => i === at ? { ...r, error } : r));
        if (c.errorExpected) assert.deepEqual(await c.invoke(api, signal), c.errorExpected);
        else await assert.rejects(() => c.invoke(api, signal), e => e === error);
        assert.equal(aiError(error), 'fixture denied');
        assert.equal(loggingError(error, 'fallback'), 'fixture denied');
        assert.equal(proxyError(error), 'fixture denied');
      }
      h.done();
    } finally { h.close(); }
  }
});

test('client API error helpers do not expose arbitrary transport or secret errors', () => {
  for (const error of [new Error('secret token'), { message: 'secret token' }, null, 'secret token']) {
    assert.equal(aiError(error), '无法完成 AI 操作，请检查本地服务或网络后重试。');
    assert.equal(proxyError(error), '无法完成代理操作，请检查本地服务或网络后重试。');
    assert.equal(loggingError(error, 'safe fallback'), 'safe fallback');
  }
});

test('client live read cancellation reaches the request boundary', async () => {
  const controller = new AbortController();
  const h = harness(controller.signal);
  try {
    await installWorkspaceAgent(h.client);
    h.expect([{ host: 'local-agent', method: 'repositories.get', params: { resource }, response: alias, options: undefined }]);
    const original = h.client.request;
    h.client.request = async (method, params, options) => {
      if (method === 'repositories.get') return original(method, params, options);
      assert.equal(method, 'repositories.read');
      assert.deepEqual(params, { resource, kind: 'file', params: { path: 'a.ts' } });
      assert.equal(options.signal.aborted, false);
      controller.abort(new Error('caller cancelled'));
      assert.equal(options.signal.aborted, true);
      throw options.signal.reason;
    };
    await assert.rejects(repositoryApi.file('repo-1', 'a.ts', controller.signal), e => e === controller.signal.reason);
    h.done();
  } finally { h.close(); }
});

test('client collaboration unknown write outcome queries task and forbids blind resubmit', async () => {
  const h = harness(new AbortController().signal);
  const operationId = '11111111-1111-4111-8111-111111111111';
  const input = { operationId, remote: 'origin', targetBranch: 'main', sourceBranch: 'topic', title: 'Review', description: 'body', revision: 'preview-r1' };
  const error = new ProtocolError('disconnected', 'response lost', 'unknown');
  try {
    await installWorkspaceAgent(h.client);
    h.expect([
      { host: 'local-agent', method: 'repositories.get', params: { resource }, response: alias, options: undefined },
      { host: 'local-agent', method: 'reviews.create', params: { resource, input }, options: { timeoutMs: 90000 }, error },
      { host: 'local-agent', method: 'tasks.get', params: { taskId: operationId }, response: { scope: 'agent', task: null }, options: undefined },
    ]);
    await assert.rejects(repositoryApi.createPullRequest('repo-1', input), e => {
      assert.equal(e.cause, error);
      assert.equal(e.message, 'response lost（操作 11111111-1111-4111-8111-111111111111；请刷新并在托管平台核对，请勿重复提交。）');
      return true;
    });
    h.done();
    assert.equal(h.count(), 3);
  } finally { h.close(); }
});

test('client Git unknown outcome reports succeeded task receipt without executing twice', async () => {
  const h = harness(new AbortController().signal);
  const c = cases.find(c => c.entryId === 'client-api:apps/web/src/api/index.ts:gitApi.stage');
  try {
    await installWorkspaceAgent(h.client);
    h.expect([
      ...c.requests.slice(0, 2),
      { ...c.requests[2], error: new ProtocolError('disconnected', 'response lost', 'unknown') },
      { host: 'local-agent', method: 'tasks.get', params: { taskId: '$operationId' }, options: undefined,
        response: { scope: 'agent', task: { taskId: '$operationId', requestId: 'write-request-1', method: 'repositories.write', effect: 'mutation', state: 'succeeded', outcome: 'completed', startedAt: 100, finishedAt: 200 } } },
    ]);
    await assert.rejects(gitApi.stage('repo-1', ['a.ts', 'space name.txt']), e => {
      assert.match(h.operationId(), uuidV4);
      assert.equal(e.message.replace(h.operationId(), '$operationId'), 'response lost（操作 $operationId；已执行成功，响应丢失，请勿重复执行。）');
      return true;
    });
    h.done();
    assert.equal(h.count(), 4, 'one lookup, one prepare, one write, one task lookup; no retry');
  } finally { h.close(); }
});
