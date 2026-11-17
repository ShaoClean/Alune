const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const errors = require('../dist/ports/provider-error');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const nest = { ...errors, HttpException: errors.ProviderError, Injectable: () => () => {}, Optional: () => () => {} };
const cache = new Map();
function frozen(name) {
  if (cache.has(name)) return cache.get(name);
  const file = 'apps/server/src/repository/' + name + '.ts';
  const source = execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' });
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} }; cache.set(name, module.exports);
  vm.compileFunction(output, ['require', 'module', 'exports'], { filename: baseline + '/' + file })(dependency => {
    if (dependency === '@nestjs/common') return nest;
    if (dependency === '../logging/logger') return { traceHttp: (_s, _m, _u, _c, send) => send() };
    // Range helpers belong to comment writing, outside these selected methods.
    // Their old/new direct parity is covered by the separate model tests.
    if (dependency === '@alune/shared') return require('@alune/domain');
    if (dependency.startsWith('node:')) return require(dependency);
    if (dependency.startsWith('./pull-request')) return frozen(dependency.slice(2));
    throw Error('Unreviewed frozen dependency: ' + dependency);
  }, module, module.exports);
  cache.set(name, module.exports); return module.exports;
}
const next = name => require('../dist/modules/reviews/' + name);
const pairs = name => [frozen(name), next(name)];
const remote = { name: 'origin', fetchUrl: 'https://github.com/team/repo.git' };
const query = { remote: 'origin', target: 'https://github.com/team/repo', provider: 'github', state: 'open', page: 1, number: 1 };
const rawItem = { number: 1, title: '<literal>', state: 'open', updated_at: '2026-11-01T00:00:00Z', user: { login: 'actor' }, head: { ref: 'topic' }, base: { ref: 'main' }, requested_reviewers: [{ login: 'reviewer' }], html_url: 'javascript:unsafe' };
const signal = () => new AbortController().signal;
const outcome = async work => { try { return { value: await work() }; } catch (error) { return { error: error.message, status: error.getStatus?.() }; } };
function requestService(Module) {
  const reconciled = [], selection = { status: 'none', tokenId: 'synthetic-id', version: 'v:1' };
  const repositories = { async getRemotes(id) { assert.equal(id, 'repo'); return [remote]; } };
  const tokens = { reconcile: (...args) => reconciled.push(args), selection: () => selection, credential: () => ({ token: 'synthetic-secret', assertCurrent() {} }) };
  return { service: new Module.PullRequestsService(repositories, tokens), repositories, tokens, selection, reconciled };
}

test('P0 PR normalization and remote targeting preserve trusted URLs, binding revisions and masked failures', async () => {
  const results = [];
  for (const Module of pairs('pull-requests.service')) {
    const f = requestService(Module), parsed = await f.service.readRemotes('repo', signal());
    assert.equal(parsed[0].webUrl, query.target); assert.equal(f.reconciled.length, 1);
    assert.equal((await f.service.target('repo', query, signal())).project, 'team/repo');
    const refusals = [];
    for (const change of [{ remote: 'missing' }, { target: 'https://foreign.invalid/x' }, { provider: 'gitlab' }, { selectionVersion: 'stale' }])
      refusals.push(await outcome(() => f.service.target('repo', { ...query, ...change }, signal())));
    assert(refusals.every(r => r.error));
    const normalized = Module.normalizeItem(rawItem, parsed[0], query);
    assert.equal(normalized.url, 'https://github.com/team/repo/pull/1'); assert.equal(normalized.title, '<literal>');
    for (const change of [{ number: 0 }, { title: 1 }, { state: 'bad' }, { updated_at: 'bad' }])
      assert.throws(() => Module.normalizeItem({ ...rawItem, ...change }, parsed[0], query), /数据格式/);
    const masked = await outcome(() => f.service.withDeadline(async () => { throw Error('synthetic-secret'); }));
    assert.match(masked.error, /无法读取 PR/); assert(!masked.error.includes('synthetic-secret'));
    results.push({ parsed, normalized, refusals, masked });
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 PR request wrapper preserves temporary anonymous selection, exact headers and no unauthorized write dispatch', async t => {
  const results = [];
  for (const Module of pairs('pull-requests.service')) {
    const f = requestService(Module), calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url: String(url), headers: options.headers, method: options.method || 'GET', redirect: options.redirect }); return new Response(JSON.stringify([rawItem]), { headers: { Link: '<https://api.github.com/next>; rel="next"' } }); });
    const page = await f.service.list('repo', query);
    assert.equal(page.hasMore, true); assert.equal(page.items.length, 1); assert.equal(calls[0].headers.Authorization, 'Bearer synthetic-secret'); assert.equal(calls[0].redirect, 'error');
    await f.service.withRequest('repo', { ...query, token: '' }, async (_r, request, authenticated) => {
      assert.equal(authenticated, false); await request(new URL('https://api.github.com/synthetic'));
      await assert.rejects(request(new URL('https://api.github.com/write'), { method: 'POST', body: { literal: true } }), /写入权限/);
    });
    assert.equal(calls.length, 2); assert.equal(calls[1].headers.Authorization, undefined);
    results.push({ page, calls });
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 PR detail checks bracket file reads and cached center identities never substitute for resource revisions', async t => {
  const results = [];
  for (const Module of pairs('pull-requests.service')) {
    const { service } = requestService(Module); let detailCalls = 0, readCalls = 0;
    service.detail = async () => ({ revision: ++detailCalls === 1 ? 'revision' : 'changed' });
    await assert.rejects(service.checkedFiles('repo', { ...query, revision: 'revision' }, async () => { readCalls++; return { items: [] }; }), /Diff 已变化/);
    assert.equal(detailCalls, 2); assert.equal(readCalls, 1);
    service.detail = async () => ({ revision: 'changed' });
    await assert.rejects(service.checkedFiles('repo', { ...query, revision: 'revision' }, async () => { readCalls++; }), /Diff 已变化/); assert.equal(readCalls, 1);
    const urls = [];
    t.mock.method(globalThis, 'fetch', async url => { urls.push(String(url)); return new Response(JSON.stringify(String(url).endsWith('/user') ? { login: 'Actor' } : [rawItem])); });
    const first = await service.centerPage('repo', query), second = await service.centerPage('repo', query);
    assert.equal(urls.filter(u => u.endsWith('/user')).length, 1); assert.deepEqual(first, second);
    assert.deepEqual(first.items[0].reviewers, ['reviewer']); assert.equal(first.account.username, 'Actor');
    assert.equal(service.projectUrl({ host: 'git.example.invalid', project: 'team/repo name' }, 'gitlab').href, 'https://git.example.invalid/api/v4/projects/team%2Frepo%20name');
    service.assertDetail(rawItem, query); assert.throws(() => service.assertDetail({ ...rawItem, number: 2 }, query), /不同或无效/);
    results.push({ first, second, urls });
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 PR creation templates and options preserve bounded literals, sorted fallback and permission notices', async () => {
  const results = [];
  for (const Module of pairs('pull-request-creation.service')) {
    const service = new Module.PullRequestCreationService({}, {}), calls = [], target = { webUrl: query.target, project: 'team/repo', host: 'github.com' };
    const template = await service.template(target, true, 'main literal', async url => {
      calls.push(url.href);
      if (url.pathname.endsWith('/.github/PULL_REQUEST_TEMPLATE')) return { data: [{ name: 'z.md', type: 'file' }, { name: 'a.md', type: 'file' }, { name: '../bad.md', type: 'file' }] };
      if (url.pathname.endsWith('/a.md')) return { data: { encoding: 'base64', content: Buffer.from('x'.repeat(12001)).toString('base64') } };
      throw new errors.ProviderError('not found', 404);
    });
    assert.equal(template.path, '.github/PULL_REQUEST_TEMPLATE/a.md'); assert.equal(template.content.length, 12000); assert.match(template.notice, /截断/);
    assert(calls.every(u => new URL(u).searchParams.get('ref') === 'main literal'));
    const options = await service.options(target, true, async url => {
      if (url.pathname.endsWith('/collaborators')) throw new errors.ProviderError('denied', 403);
      return { data: url.pathname.endsWith('/labels') ? [{ name: 'literal 中文' }] : [{ login: 'actor' }], hasMore: true };
    });
    assert.deepEqual(options.assignees, [{ value: 'actor', label: 'actor' }]); assert.deepEqual(options.reviewers, []); assert.deepEqual(options.labels, [{ value: 'literal 中文', label: 'literal 中文' }]); assert(options.notice);
    results.push({ template, options, calls });
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 PR center slots, context and pruning preserve bounded concurrency and failure cleanup', async () => {
  for (const Module of pairs('pull-request-center.service')) {
    const requests = { async centerPage(id, query) { return { account: { username: id }, identityNotice: query.notice }; } };
    const service = new Module.PullRequestCenterService({}, requests), releases = []; let entered = 0;
    const work = Array.from({ length: 5 }, () => service.withSlot(async () => { entered++; await new Promise(resolve => releases.push(resolve)); }));
    assert.equal(entered, 4); assert.equal(service.active, 4); assert.equal(service.waiting.length, 1);
    releases[0](); await work[0]; assert.equal(entered, 5);
    releases.slice(1).forEach(resolve => resolve()); await Promise.all(work); assert.equal(service.active, 0); assert.equal(service.waiting.length, 0);
    await assert.rejects(service.withSlot(async () => { throw Error('controlled failure'); }), /controlled failure/); assert.equal(service.active, 0);
    assert.deepEqual(await service.context('actor', { notice: 'literal' }), { account: { username: 'actor' }, identityNotice: 'literal' });
    const entries = new Map([['expired', { touched: Date.now() - 600001 }], ...Array.from({ length: 26 }, (_, i) => ['entry-' + i, { touched: Date.now() }])]);
    service.prune(entries); assert.equal(entries.size, 23); assert.equal(entries.has('expired'), false); assert.equal(entries.has('entry-0'), false);
  }
});

test('P0 PR center merge waits for every bounded source head and deduplicates exact project identities', async t => {
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 13));
  const results = [];
  for (const Module of pairs('pull-request-center.service')) {
    const calls = [], sources = Array.from({ length: 5 }, (_, i) => ({ id: 'source-' + i, repositoryId: 'repo-' + i, provider: 'github', projectKey: 'github:github.com:team/repo', status: 'ready', account: null, remote: { name: 'origin', webUrl: query.target, selection: { version: 'v:1' } } }));
    const item = { number: 1, title: 'literal', state: 'open', author: 'actor', sourceBranch: 'topic', targetBranch: 'main', updatedAt: '2026-11-13T00:00:00Z', reviewers: [] };
    const requests = { async centerPage(id, q) { calls.push({ id, q }); return { account: null, hasMore: false, items: [structuredClone(item)] }; } };
    const service = new Module.PullRequestCenterService({}, requests);
    const session = { query: { view: 'all', state: 'open', search: '', provider: '', account: '', projects: [] }, sources, streams: sources.map(source => ({ source, page: 1, more: true, buffer: [] })), seen: new Set(), touched: Date.now(), step: 0, steps: new Map() };
    const first = await service.advance(session, 'query-id', 0);
    assert.equal(calls.length, 4); assert.deepEqual(first.items, []); assert.equal(first.scanning, true); assert(first.nextCursor);
    const second = await service.advance(session, 'query-id', 1);
    assert.equal(calls.length, 5); assert.equal(second.items.length, 1); assert.equal(second.nextCursor, null);
    assert.equal(second.items[0].key, 'github:github.com:team/repo:1'); assert.deepEqual(second.items[0].sourceIds, sources.map(s => s.id));
    assert.equal(session.seen.size, 1); assert.equal(second.completedSources, 5);
    assert(Number.isFinite(Date.parse(first.updatedAt))); assert(Number.isFinite(Date.parse(second.updatedAt)));
    results.push({ first: { ...first, updatedAt: '<wall clock>' }, second: { ...second, updatedAt: '<wall clock>' }, calls });
  }
  assert.deepEqual(results[1], results[0]);
});
