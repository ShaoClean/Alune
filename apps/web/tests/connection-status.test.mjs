import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const { hydrateWorkspace } = await import('../src/stores/workspaceStore.ts');
const { useConnectionStore: connections } = await import('../src/stores/connectionStore.ts');
const { connectionApi } = await import('../src/api/index.ts');
const { WorkspaceTree } = await import('../src/components/WorkspaceTree.tsx');
await hydrateWorkspace();

const listed = (overrides = {}) => [
  { id: 'dev', name: '开发服务器', status: 'unknown', ...overrides },
];
const dots = (html) => [...html.matchAll(/class="connection-dot connection-dot--(\w+)"/g)].map(([, state]) => state);
const renderTree = (statuses) =>
  renderToStaticMarkup(
    createElement(WorkspaceTree, {
      connections: [{ id: 'dev', name: '开发服务器' }],
      repositories: [{ id: 'repo-a', connectionId: 'dev', name: 'alune', path: '/w/alune' }],
      statuses,
      onOpenRepository() {},
    }),
  );

beforeEach(() => {
  connections.setState(connections.getInitialState(), true);
  storage.clear();
});

test('列表返回的实际连接状态直接进入 store，未建连时保持未测试', async () => {
  connectionApi.list = async () => listed();
  await connections.getState().fetchConnections();
  assert.deepEqual(connections.getState().statuses.dev, { status: 'unknown', error: undefined, updatedAt: undefined });

  connectionApi.list = async () => listed({ status: 'connected', updatedAt: 10 });
  await connections.getState().fetchConnections();
  assert.equal(connections.getState().statuses.dev.status, 'connected');
});

test('打开仓库触发的推送事件无需测试连接即可更新状态', () => {
  const apply = connections.getState().applyConnectionStatus;
  apply({ connectionId: 'dev', status: 'connecting', updatedAt: 1 });
  assert.equal(connections.getState().statuses.dev.status, 'connecting');
  apply({ connectionId: 'dev', status: 'connected', updatedAt: 2 });
  assert.equal(connections.getState().statuses.dev.status, 'connected');
});

test('过期的事件与列表响应都不能覆盖更新的状态', async () => {
  const apply = connections.getState().applyConnectionStatus;
  apply({ connectionId: 'dev', status: 'connected', updatedAt: 20 });
  apply({ connectionId: 'dev', status: 'disconnected', updatedAt: 5 });
  assert.equal(connections.getState().statuses.dev.status, 'connected');
  connectionApi.list = async () => listed({ status: 'unknown', updatedAt: 3 });
  await connections.getState().fetchConnections();
  assert.equal(connections.getState().statuses.dev.status, 'connected');
});

test('失败的连接报告错误而不是在线，且状态按连接隔离', () => {
  const apply = connections.getState().applyConnectionStatus;
  apply({ connectionId: 'dev', status: 'connected', updatedAt: 1 });
  apply({ connectionId: 'build', status: 'error', error: '认证失败', updatedAt: 1 });
  assert.equal(connections.getState().statuses.dev.status, 'connected');
  assert.deepEqual(connections.getState().statuses.build, {
    status: 'error',
    error: '认证失败',
    updatedAt: 1,
  });
});

test('显式测试只补齐缺失状态，旧响应不覆盖推送，删除时清理状态', async () => {
  connectionApi.test = async () => ({ success: true, status: 'connected', updatedAt: 4 });
  await connections.getState().testConnection('dev');
  assert.equal(connections.getState().statuses.dev.status, 'connected');

  connections.getState().applyConnectionStatus({ connectionId: 'dev', status: 'connected', updatedAt: 9 });
  connectionApi.test = async () => ({
    success: false,
    status: 'error',
    error: '过期结果',
    updatedAt: 8,
  });
  await connections.getState().testConnection('dev');
  assert.equal(connections.getState().statuses.dev.status, 'connected');

  connectionApi.delete = async () => {};
  await connections.getState().deleteConnection('dev');
  assert.equal(connections.getState().statuses.dev, undefined);
});

test('工具区图标随实际连接状态变化，未建连时显示未测试圆点', () => {
  assert.deepEqual(dots(renderTree({})), ['unknown']);
  assert.deepEqual(dots(renderTree({ dev: { status: 'connected' } })), ['connected']);
  assert.deepEqual(dots(renderTree({ dev: { status: 'connecting' } })), ['connecting']);
  const failed = renderTree({ dev: { status: 'error', error: '认证失败' } });
  assert.deepEqual(dots(failed), ['error']);
  assert.match(failed, /连接状态：连接失败/);
  assert.match(failed, /title="连接失败 · 认证失败"/);
});
