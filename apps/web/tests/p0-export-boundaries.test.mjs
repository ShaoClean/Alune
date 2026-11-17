import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { formatRelativeDate, formatBranchName } from '../src/components/ui.tsx';
import { CommitSignatureBadge } from '../src/components/CommitSignatureBadge.tsx';
import { PullRequestStatus, PullRequestBranches } from '../src/components/PullRequestPresentation.tsx';
import { defaultPullRequestRemote } from '../src/components/PullRequestsView.tsx';
import { mergeDiscussions } from '../src/components/PullRequestDetails.tsx';
import { BrandIcon } from '../src/components/BrandIcon.tsx';
import { UnifiedViewIcon, SplitViewIcon } from '../src/components/DiffViewIcons.tsx';
import { defaultCenterQuery, centerListUrl } from '../src/stores/pullRequestCenter.ts';
import { defaultCommitModel, useAiSettingsStore } from '../src/stores/aiSettingsStore.ts';
import { aiApi } from '../src/api/ai.ts';
import { confirmTerminalRemoval, registerTerminalRemovalConfirmation } from '../src/stores/terminalRemoval.ts';
import { logBridge, openLogViewer, loggingApi } from '../src/api/logging.ts';
import { installClientErrorReporting } from '../src/logging/clientErrors.ts';
import { RepositoryWorkspaceContext, useRepositoryWorkspace, useWorkspaceLocation, workspaceListId } from '../src/hooks/useRepositoryWorkspace.ts';

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('P0 date and branch formatting retain exact invalid, threshold and literal boundaries', t => {
  const now = Date.UTC(2026, 10, 13, 12); t.mock.method(Date, 'now', () => now);
  assert.equal(formatRelativeDate(), '—'); assert.equal(formatRelativeDate('bad'), '—');
  for (const [seconds, expected] of [[0, '刚刚'], [59, '刚刚'], [60, '1 分钟前'], [3599, '59 分钟前'], [3600, '1 小时前'], [86399, '23 小时前'], [86400, '1 天前'], [604799, '6 天前']])
    assert.equal(formatRelativeDate(new Date(now - seconds * 1000)), expected);
  const old = new Date(now - 604800000);
  assert.equal(formatRelativeDate(old), old.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }));
  assert.equal(formatBranchName(), '—'); assert.equal(formatBranchName('BRANCH.HEAD topic 中文'), 'topic 中文');
  assert.equal(formatBranchName('literal branch.head topic'), 'literal branch.head topic');
});

test('P0 signature badges preserve all trust labels, reasons and escaped signer metadata', () => {
  assert.match(render(CommitSignatureBadge, {}), /验证中…/);
  assert.match(render(CommitSignatureBadge, { error: 'missing <key>' }), /验证失败/);
  for (const [status, label] of Object.entries({ valid: '签名有效', invalid: '签名无效', unknown: '未知密钥／信任', unsigned: '未签名' }))
    assert.match(render(CommitSignatureBadge, { signature: { status, code: 'G' } }), new RegExp(label));
  for (const [code, reason] of Object.entries({ G: '执行主机验证通过', B: '签名不匹配', U: '签名正确，但签名者身份未受信任', X: '签名已过期', Y: '签名密钥已过期', R: '签名密钥已撤销', E: '无法验证', N: '此提交没有签名' })) {
    const html = render(CommitSignatureBadge, { detail: true, signature: { status: 'unknown', code, signer: '<script>literal</script>', key: 'KEY' } });
    assert(html.includes(reason)); assert(html.includes('&lt;script&gt;literal&lt;/script&gt;')); assert(!html.includes('<script>')); assert(html.includes('<small>'));
  }
});

test('P0 PR presentation preserves status, missing branches and escaped literal refs', () => {
  for (const [state, label] of Object.entries({ open: '开放中', closed: '已关闭', merged: '已合并' })) {
    const html = render(PullRequestStatus, { state }); assert(html.includes(label)); assert(html.includes('pull-request-status--' + state));
  }
  const missing = render(PullRequestBranches, {}); assert(missing.includes('已删除分支')); assert(missing.includes('未知分支'));
  const literal = render(PullRequestBranches, { sourceBranch: '<topic>', targetBranch: 'main&next' });
  assert(literal.includes('&lt;topic&gt;')); assert(literal.includes('main&amp;next')); assert(!literal.includes('<topic>'));
});

test('P0 PR remote defaults and discussion merges preserve availability and latest comment identity', () => {
  const origin = { name: 'origin', unavailableReason: 'unavailable' }, other = { name: 'other', provider: 'gitlab' }, plain = { name: 'plain' };
  assert.equal(defaultPullRequestRemote([]), ''); assert.equal(defaultPullRequestRemote([plain, other, origin]), 'other');
  assert.equal(defaultPullRequestRemote([plain, { ...origin, unavailableReason: '' }, other]), 'origin');
  assert.equal(defaultPullRequestRemote([origin, plain]), 'plain'); assert.equal(defaultPullRequestRemote([origin]), 'origin');
  const items = [{ id: 't', comments: [{ id: 'a', body: 'old' }], resolved: false }, { id: 'other', comments: [] }, { id: 't', comments: [{ id: 'a', body: 'new' }, { id: 'b', body: '<literal>' }], resolved: true }];
  const before = structuredClone(items), result = mergeDiscussions(items);
  assert.deepEqual(result, [{ id: 't', resolved: true, comments: [{ id: 'a', body: 'new' }, { id: 'b', body: '<literal>' }] }, { id: 'other', comments: [] }]);
  assert.deepEqual(items, before);
  assert.deepEqual(defaultCenterQuery, { view: 'all', state: 'open', search: '', projects: [], provider: '', account: '' });
  assert.equal(centerListUrl(defaultCenterQuery), '/pull-requests');
  assert.equal(centerListUrl({ ...defaultCenterQuery, search: '中文 & literal', projects: ['b', 'a'] }), '/pull-requests?q=%E4%B8%AD%E6%96%87+%26+literal&project=a&project=b');
});

test('P0 AI settings accept invalidates pending loads and model selection requires enabled saved identities', async t => {
  const original = useAiSettingsStore.getState(); t.after(() => useAiSettingsStore.setState(original, true));
  let resolve; t.mock.method(aiApi, 'settings', () => new Promise(r => { resolve = r; }));
  const config = { providers: [{ id: 'p', enabled: true, models: [{ id: 'm', enabled: true }] }], commit: { providerId: 'p', modelId: 'm' } };
  assert.equal(defaultCommitModel(null), null); assert.equal(defaultCommitModel({ ...config, providers: [] }), null);
  assert.equal(defaultCommitModel({ ...config, providers: [{ ...config.providers[0], enabled: false }] }), null);
  assert.equal(defaultCommitModel({ ...config, commit: { providerId: 'p', modelId: 'missing' } }), null);
  assert.deepEqual(defaultCommitModel(config), { provider: config.providers[0], model: config.providers[0].models[0] });
  const pending = useAiSettingsStore.getState().load(); assert.equal(useAiSettingsStore.getState().loading, true);
  useAiSettingsStore.getState().accept(config); resolve({ stale: true }); await pending;
  assert.equal(useAiSettingsStore.getState().settings, config); assert.equal(useAiSettingsStore.getState().loading, false);
  t.mock.method(aiApi, 'settings', async () => { throw Error('synthetic internal failure'); });
  await useAiSettingsStore.getState().load(); assert.equal(useAiSettingsStore.getState().loading, false); assert(useAiSettingsStore.getState().error);
  assert.equal(useAiSettingsStore.getState().settings, config);
});

test('P0 terminal removal defaults to refusal and forwards exact scope without swallowing errors', async t => {
  t.after(() => registerTerminalRemovalConfirmation()); registerTerminalRemovalConfirmation();
  const sessions = [{ id: 'a', repositoryId: 'r', state: 'running' }];
  assert.equal(await confirmTerminalRemoval(sessions), false);
  let received; registerTerminalRemovalConfirmation(async value => { received = value; return true; });
  assert.equal(await confirmTerminalRemoval(sessions), true); assert.equal(received, sessions);
  registerTerminalRemovalConfirmation(async () => false); assert.equal(await confirmTerminalRemoval(sessions), false);
  registerTerminalRemovalConfirmation(async () => { throw Error('controlled refusal'); }); await assert.rejects(confirmTerminalRemoval(sessions), /controlled refusal/);
});

test('P0 log viewer dispatch and renderer error listeners retain desktop routing, deduplication and cleanup', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'window', prior); else delete globalThis.window; });
  delete globalThis.window; assert.equal(logBridge(), undefined);
  const listeners = new Map(), calls = [], reports = [];
  globalThis.window = { location: { pathname: '/fixture' }, open: (...args) => calls.push(args), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); } };
  await openLogViewer(); assert.deepEqual(calls, [['/logs', 'alune-logs']]);
  window.aluneLogs = { openWindow: async () => calls.push('desktop') }; assert.equal(logBridge(), window.aluneLogs);
  await openLogViewer(); assert.equal(calls.at(-1), 'desktop');
  t.mock.method(loggingApi, 'report', async (...args) => { reports.push(args); throw Error('reporting failure'); });
  const dispose = installClientErrorReporting(); assert.deepEqual([...listeners.keys()], ['error', 'unhandledrejection']);
  const error = new Error('isolated-p0-renderer-error');
  listeners.get('error')({ error, filename: 'fixture.ts', lineno: 7 }); listeners.get('error')({ error });
  listeners.get('unhandledrejection')({ reason: 'isolated-rejection' }); await Promise.resolve();
  assert.equal(reports.length, 2); assert.equal(reports[0][0], 'ERROR'); assert.equal(reports[0][2].page, '/fixture'); assert.equal(reports[0][2].line, 7);
  assert.match(reports[1][1], /isolated-rejection/); dispose(); assert.equal(listeners.size, 0);
});

test('P0 workspace context keeps hidden-tab location and exact repository list identity', () => {
  function Probe() { const workspace = useRepositoryWorkspace(); const location = useWorkspaceLocation(); return React.createElement('output', {}, JSON.stringify({ repoId: workspace?.repoId ?? null, path: location.pathname })); }
  const renderProbe = value => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/foreground'] }, React.createElement(RepositoryWorkspaceContext.Provider, { value }, React.createElement(Probe))));
  assert.equal(workspaceListId('repo:中文'), 'workspace-list-repo:中文');
  assert(renderProbe(null).includes('/foreground'));
  const hidden = renderProbe({ repoId: 'hidden', active: false, location: { pathname: '/retained' } });
  assert(hidden.includes('/retained')); assert(hidden.includes('hidden')); assert(!hidden.includes('/foreground'));
});

test('P0 brand and diff glyphs retain decorative dimensions and explicit class overrides', () => {
  const brand = render(BrandIcon, {}); assert(brand.includes('width="34"')); assert(brand.includes('height="34"')); assert(brand.includes('draggable="false"')); assert(brand.includes('aria-hidden="true"')); assert(brand.includes('app-brand__mark'));
  assert(render(BrandIcon, { className: 'custom-brand' }).includes('custom-brand'));
  const unified = render(UnifiedViewIcon, {}), split = render(SplitViewIcon, {});
  assert(unified.includes('<svg')); assert(split.includes('<svg')); assert.notEqual(unified, split);
});
