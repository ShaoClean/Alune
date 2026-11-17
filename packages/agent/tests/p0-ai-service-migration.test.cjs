// Frozen service/provider code executes with disposable ports. No external AI
// requests or credentials; assertions include exact outbound bodies and errors.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const errors = require('../dist/ports/provider-error');
const { StagedChangesError } = require('../dist/modules/git/staged-changes');
const Current = require('../dist/modules/ai/service').AiService;
const providerNext = require('../dist/adapters/providers/ai-provider');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const nest = { HttpException: errors.ProviderError, Injectable: () => () => {}, Optional: () => () => {} };
for (const name of ['BadGatewayException', 'BadRequestException', 'ConflictException', 'GatewayTimeoutException']) nest[name] = errors[name];
function frozen(name, dependencies) {
  const file = 'apps/server/src/ai/' + name + '.ts';
  const source = execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' });
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.compileFunction(output, ['require', 'module', 'exports'], { filename: baseline + '/' + file })(name => {
    if (name === '@nestjs/common') return nest;
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error('Unreviewed frozen dependency: ' + name);
  }, module, module.exports);
  return module.exports;
}
const providerOld = frozen('ai-provider', { '../logging/logger': { traceHttp: (_s, _m, _u, _c, send) => send() } });
const signal = () => new AbortController().signal;
const base = { id: 'fixture', name: 'Fixture', enabled: true, protocol: 'openai', baseUrl: 'https://ai.invalid/v1', models: [{ id: 'model', enabled: true }] };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const reply = text => ({ choices: [{ finish_reason: 'stop', message: { content: text } }] });
async function outcome(work) { try { return { value: await work() }; } catch (e) { return { error: e.message, status: e.statusCode ?? e.getStatus?.() }; } }

test('P0 AI providers preserve literal requests, protocol replies and fail-closed response limits', async () => {
  for (const protocol of ['openai', 'anthropic', 'gemini']) {
    const responses = {
      openai: reply(' literal 中文 '),
      anthropic: { stop_reason: 'end_turn', content: [{ type: 'text', text: ' literal 中文 ' }, { type: 'tool', text: 'hidden' }] },
      gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: ' literal 中文 ' }, { thought: true, text: 'hidden' }] } }] },
    };
    const observed = [];
    for (const mod of [providerOld, providerNext]) {
      const calls = [];
      const fetch = async (url, options) => { calls.push({ url, method: options.method, headers: options.headers, body: JSON.parse(options.body), redirect: options.redirect }); return json(responses[protocol]); };
      assert.equal(await mod.complete({ ...base, protocol }, 'synthetic-key', 'model/中文', 'system literal', 'user literal', signal(), fetch), 'literal 中文');
      assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].redirect, 'error');
      assert.equal(calls[0].headers[protocol === 'anthropic' ? 'x-api-key' : protocol === 'gemini' ? 'x-goog-api-key' : 'Authorization'], protocol === 'openai' ? 'Bearer synthetic-key' : 'synthetic-key');
      const body = calls[0].body;
      if (protocol === 'openai') assert.deepEqual(body.messages, [{ role: 'system', content: 'system literal' }, { role: 'user', content: 'user literal' }]);
      if (protocol === 'anthropic') { assert.equal(body.system, 'system literal'); assert.equal(body.max_tokens, 2048); }
      if (protocol === 'gemini') { assert.deepEqual(body.systemInstruction, { parts: [{ text: 'system literal' }] }); assert.match(calls[0].url, /model%2F/); }
      observed.push(calls);
    }
    assert.deepEqual(observed[1], observed[0]);
  }
  const cases = [
    () => new Response('upstream synthetic-key', { status: 401 }),
    () => new Response('upstream synthetic-key', { status: 429 }),
    () => new Response('invalid JSON'),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
    () => json(reply('')),
    () => json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }),
  ];
  for (const response of cases) {
    const results = [];
    for (const mod of [providerOld, providerNext]) results.push(await outcome(() => mod.complete(base, 'synthetic-key', 'm', 's', 'u', signal(), async () => response())));
    assert.deepEqual(results[1], results[0]); assert(results[0].error); assert.doesNotMatch(results[0].error, /synthetic-key|upstream/);
  }
});

test('P0 AI model pagination preserves deduplication, filters and incomplete-page refusal', async () => {
  for (const protocol of ['openai', 'anthropic', 'gemini']) {
    const observed = [];
    for (const mod of [providerOld, providerNext]) {
      const calls = [];
      const fetch = async url => {
        calls.push(url);
        if (protocol === 'openai') return json({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }] });
        if (protocol === 'anthropic') return json({ data: [{ id: calls.length === 1 ? 'a' : 'z' }], has_more: calls.length === 1, last_id: 'cursor literal' });
        return json({ models: [{ name: 'models/' + (calls.length === 1 ? 'a' : 'z'), supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }], ...(calls.length === 1 ? { nextPageToken: 'cursor literal' } : {}) });
      };
      const models = await mod.fetchModels({ ...base, protocol }, '', signal(), fetch);
      assert.deepEqual(models.map(x => x.id).sort(), ['a', 'z']);
      assert(models.every(x => typeof x.enabled === 'boolean'));
      if (protocol !== 'openai') { assert.equal(calls.length, 2); assert.match(calls[1], /cursor%20literal/); }
      const incomplete = await outcome(() => mod.fetchModels({ ...base, protocol: 'anthropic' }, '', signal(), async () => json({ data: [{ id: 'a' }], has_more: true, last_id: 'same' })));
      assert.match(incomplete.error, /分页未完成/);
      observed.push({ models, calls, incomplete });
    }
    assert.deepEqual(observed[1], observed[0]);
  }
});

function serviceFixture(legacy) {
  const config = { providers: [structuredClone(base)], commit: { providerId: 'fixture', modelId: 'model', language: 'zh-CN', format: 'conventional', prompt: 'Team literal' } };
  let revision = 'config', stagedRevision = 'staged', releaseCount = 0, response = JSON.stringify({ message: 'fix: literal', description: 'body' });
  const calls = [];
  const settings = {
    assertRevision(value) { if (value !== revision) throw new errors.ConflictException('配置已变化'); },
    provider(id) { assert.equal(id, 'fixture'); return config.providers[0]; },
    key(id) { assert.equal(id, 'fixture'); return 'synthetic-key'; }, read() { return structuredClone(config); },
    saveModels(id, models, rev) { this.assertRevision(rev); config.providers[0].models = models; return this.read(); },
  };
  const staged = { async read() { return { revision: 'staged', diff: { files: [{ path: 'literal 中文', patch: '+literal' }] } }; }, async assertRevision(value) { if (value !== stagedRevision) throw new StagedChangesError('staged changed', 409); } };
  const connection = { holdTask() { return () => { releaseCount++; }; } };
  const preview = { revision: 'pr', pushRequired: false, sourceBranch: 'topic', targetBranch: 'main', template: '', commits: [{ hash: 'a', message: 'literal' }], files: [] };
  const creation = { async preview() { return structuredClone(preview); } };
  const fetch = async (url, options) => { calls.push({ url, body: options.body && JSON.parse(options.body) }); return url.endsWith('/models') ? json({ data: [{ id: 'new' }, { id: 'model' }] }) : json(reply(response)); };
  let service;
  if (legacy) {
    const Old = frozen('ai.service', {
      '@alune/ssh-client': { StagedChanges: class { constructor() { return staged; } }, StagedChangesError },
      './ai-provider': providerOld, './pull-request-prompt': require('../dist/modules/ai/pull-request-prompt'),
    }).AiService;
    service = new Old(settings, { async ensureConnected() { return connection; } }, { async get() { return { source: 'ssh', connectionId: 'host', path: '/repo' }; } }, { fetch }, creation);
  } else service = new Current(settings, async () => ({ staged, release: () => { releaseCount++; } }), fetch, creation);
  return { service, config, calls, preview, get releases() { return releaseCount; }, setResponse(value) { response = value; }, changeStaged() { stagedRevision = 'changed'; }, changeConfig() { revision = 'changed'; } };
}

test('P0 AI service model merge, test selection and staged generation retain revisions and release', async () => {
  const results = [];
  for (const legacy of [true, false]) {
    const f = serviceFixture(legacy), s = f.service;
    const merged = await s.models('fixture', 'config', signal());
    assert.deepEqual(merged.providers[0].models.map(x => x.id), ['model', 'new']);
    assert.equal((await s.test('fixture', 'config', signal(), 'model')).message, '连接成功，已验证模型 model。');
    await assert.rejects(s.test('fixture', 'config', signal(), 'missing'), /已保存的测试模型/);
    const generated = await s.generate('repo', 'config', signal());
    assert.deepEqual(generated, { message: 'fix: literal', description: 'body', stagedRevision: 'staged', configRevision: 'config', modelId: 'model' });
    assert.equal(f.releases, 1);
    const request = f.calls.at(-1).body;
    assert.match(request.messages[0].content, /untrusted data/); assert.match(request.messages[0].content, /Team literal/);
    assert.deepEqual(JSON.parse(request.messages[1].content), { stagedDiff: { files: [{ path: 'literal 中文', patch: '+literal' }] } });
    f.changeStaged(); await assert.rejects(s.generate('repo', 'config', signal()), /staged changed/); assert.equal(f.releases, 2);
    f.setResponse('bad JSON'); await assert.rejects(s.generate('repo', 'config', signal()), /有效的提交/); assert.equal(f.releases, 3);
    f.changeConfig(); await assert.rejects(s.generate('repo', 'config', signal()), /配置已变化/); assert.equal(f.releases, 3);
    results.push({ generated, calls: f.calls });
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 AI service PR generation refuses stale branches and preserves exact draft provenance', async () => {
  const results = [];
  for (const legacy of [true, false]) {
    const f = serviceFixture(legacy); f.setResponse(JSON.stringify({ title: ' Title ', description: ' Body ' }));
    const input = { configRevision: 'config', revision: 'pr' };
    const value = await f.service.generatePullRequest('repo', input, signal());
    assert.deepEqual(value, { title: 'Title', description: 'Body', truncated: false, revision: 'pr', modelId: 'model' });
    f.preview.pushRequired = true;
    await assert.rejects(f.service.generatePullRequest('repo', input, signal()), /尚未推送/); assert.equal(f.calls.length, 1);
    f.preview.pushRequired = false; f.preview.revision = 'changed';
    await assert.rejects(f.service.generatePullRequest('repo', input, signal()), /分支已变化/); assert.equal(f.calls.length, 1);
    results.push({ value, calls: f.calls });
  }
  assert.deepEqual(results[1], results[0]);
});

test('P0 AI service shutdown and client cancellation abort active operations without erasing drafts', async () => {
  for (const legacy of [true, false]) {
    const f = serviceFixture(legacy), client = new AbortController();
    let active;
    const pending = f.service.run(client.signal, async s => { active = s; await new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason), { once: true })); });
    assert.equal(active.aborted, false); f.service.onModuleDestroy();
    await assert.rejects(pending, /草稿已保留/); assert.equal(active.aborted, true); assert.equal(f.service.active.size, 0);
    client.abort(); let called = false;
    await assert.rejects(f.service.run(client.signal, async () => { called = true; }), /草稿已保留/); assert.equal(called, false);
    await assert.rejects(f.service.run(signal(), async () => { throw Error('synthetic-key'); }), e => /操作失败/.test(e.message) && !e.message.includes('synthetic-key'));
    assert.equal(f.service.active.size, 0);
  }
});
