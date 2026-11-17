// Exact frozen/current calls. All files and credentials belong to disposable fixtures.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-p0-boundaries-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const cache = new Map(), native = createRequire(__filename);
function frozen(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const source = execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const mod = { exports: {} }; cache.set(file, mod);
  const load = name => {
    if (name === '@alune/shared') return frozen('packages/shared/src/index.ts');
    if (name === '@alune/ssh-client') return frozen('packages/ssh-client/src/index.ts');
    if (!name.startsWith('.')) return native(name);
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
    for (const candidate of [base + '.ts', base + '/index.ts']) {
      try { execFileSync('git', ['cat-file', '-e', baseline + ':' + candidate], { cwd: root, stdio: 'ignore' }); }
      catch { continue; }
      return frozen(candidate);
    }
    throw Error('Missing frozen dependency: ' + base);
  };
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  vm.compileFunction(output, ['require', 'module', 'exports', '__filename', '__dirname'], { filename: baseline + '/' + file })(load, mod, mod.exports, file, path.dirname(file));
  return mod.exports;
}
const old = name => frozen('apps/server/src/' + name + '.ts');
const next = name => require('../dist/' + name);
const errorValue = error => ({ message: error.message, status: error.getStatus?.() ?? error.statusCode });
const result = fn => { try { return { value: fn() }; } catch (error) { return { error: errorValue(error) }; } };
function pairs(a, b, samples) { for (const args of samples) assert.deepEqual(result(() => b(...structuredClone(args))), result(() => a(...structuredClone(args))), JSON.stringify(args)); }
const errors = Object.fromEntries(Object.entries({ badRequest: 400, conflict: 409, notFound: 404, unavailable: 503, writeFailed: 503 }).map(([key, status]) => [key, message => Object.assign(new Error(message), { statusCode: status })]));
function document() { let value; return { read: () => value === undefined ? undefined : structuredClone(value), write: next => { value = structuredClone(next); } }; }
const secrets = { available: true, description: 'synthetic fixture', encrypt: value => 'fixture:' + value, decrypt: value => { if (!value?.startsWith('fixture:')) throw Error('unavailable'); return value.slice(8); } };

test('P0 migrated token and model validators retain exact values and rejection boundaries', () => {
  const a = old('access-tokens/access-tokens.service').tokenValue, b = next('modules/accounts/access-tokens').tokenValue;
  pairs(a, value => b(value, errors), [undefined, null, '', 'token', 'a'.repeat(4096), 'a'.repeat(4097), 'white space', 'line\n', 'tab\t', 'nul\0', '\x7f'].map(value => [value]));
  assert.equal(b('literal-token', errors), 'literal-token');
  const x = old('ai/ai-settings').validateModels, y = next('modules/settings/ai').validateModels;
  pairs(x, value => y(value, errors), [null, {}, [], [{ id: ' m ', enabled: true }], [{ id: 'a', enabled: false }, { id: 'a', enabled: true }], [{ id: 'has space', enabled: true }], [{ id: 'a', enabled: 'true' }], Array.from({ length: 1001 }, (_, i) => ({ id: String(i), enabled: true }))].map(value => [value]));
  assert.deepEqual(y([{ id: ' m ', name: ' Model ', enabled: true }]), [{ id: 'm', name: 'Model', enabled: true }]);
});

test('P0 AI settings direct revision, readability, provider, key and persistence contracts survive migration', () => {
  const constructors = [() => new (old('ai/ai-settings').AiSettingsStore)(path.join(temp, 'ai.json'), secrets), () => new (next('modules/settings/ai').AiSettingsStore)(document(), secrets, errors)];
  const snapshots = [];
  for (const make of constructors) {
    const store = make();
    store.assertReadable();
    const before = store.read();
    store.assertRevision(before.revision);
    assert.throws(() => store.assertRevision('stale'), /配置已变化/);
    assert.throws(() => store.provider('missing'), /不存在/);
    assert.equal(store.provider('openai').name, 'OpenAI');
    assert.equal(store.key('openai'), '');
    assert.throws(() => store.key('missing'), /不存在/);
    const saved = store.saveProvider('openai', { ...store.provider('openai'), enabled: true, apiKey: 'synthetic-key' }, before.revision);
    assert.notEqual(saved.revision, before.revision);
    assert.equal(store.key('openai'), 'synthetic-key');
    assert.equal(saved.providers[0].hasApiKey, true);
    assert(!JSON.stringify(saved).includes('synthetic-key'));
    store.saveModels('openai', [{ id: 'm', enabled: true }], saved.revision);
    const selected = store.saveCommit({ providerId: 'openai', modelId: 'm', language: 'en', format: 'natural', prompt: ' literal ' }, store.read().revision);
    assert.equal(selected.commit.prompt, 'literal');
    store.saveProvider('openai', { ...store.provider('openai'), enabled: false }, selected.revision);
    assert.deepEqual(store.read().commit, { providerId: null, modelId: null, language: 'en', format: 'natural', prompt: 'literal' });
    const stable = store.read();
    assert.throws(() => store.saveProvider('openai', { ...store.provider('openai'), apiKey: 'bad\nkey' }, stable.revision), /换行/);
    assert.deepEqual(store.read(), stable);
    store.persist(structuredClone(store.data));
    assert.notEqual(store.read().revision, stable.revision);
    snapshots.push({ ...store.read(), revision: '<opaque>' });
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
  const corrupt = new (next('modules/settings/ai').AiSettingsStore)({ read() { throw Error('broken'); } }, secrets, errors);
  assert.throws(() => corrupt.assertReadable(), /无法读取/);
  const store = constructors[1]();
  assert.equal(store.text(' trim ', 'fixture', 10), 'trim');
  assert.throws(() => store.text('x'.repeat(11), 'fixture', 10), /无效/);
});

test('P0 log validation and writable-directory probes preserve exact errors without residue', () => {
  const a = old('logging/log-store'), b = next('adapters/logging');
  const settings = { level: 'INFO', retentionDays: 7, maxTotalMB: 100, customDirectory: null };
  pairs(a.validateLoggingSettings, b.validateLoggingSettings, [settings, null, { ...settings, level: 'bad' }, { ...settings, retentionDays: 0 }, { ...settings, maxTotalMB: Infinity }, { ...settings, customDirectory: 'relative' }, { ...settings, customDirectory: ' /tmp/../tmp ' }].map(x => [x]));
  for (const [i, mod] of [a, b].entries()) {
    const directory = path.join(temp, 'probe-' + i); mod.assertWritableDirectory(directory);
    assert.deepEqual(fs.readdirSync(directory), []);
    const file = path.join(temp, 'not-directory-' + i); fs.writeFileSync(file, 'preserved');
    assert.throws(() => mod.assertWritableDirectory(file), error => error instanceof mod.LogValidationError && /不是目录/.test(error.message));
    assert.equal(fs.readFileSync(file, 'utf8'), 'preserved');
    assert(new mod.LogValidationError('fixture') instanceof Error);
  }
});

test('P0 log store direct lifecycle, disk append, history reload, rotation and cleanup retain exact effects', () => {
  for (const [i, Store] of [old('logging/log-store').LogStore, next('adapters/logging').LogStore].entries()) {
    const directory = path.join(temp, 'logs-' + i); fs.mkdirSync(directory);
    const store = new Store(directory, () => new Date(2026, 10, 9, 12));
    try {
      assert.equal(store.resolveDirectory(), path.join(directory, 'logs'));
      assert.equal(store.settings().level, 'INFO');
      assert.equal(store.enabled('DEBUG'), false); assert.equal(store.enabled('ERROR'), true);
      const observed = []; const unsubscribe = store.subscribe(entry => observed.push(entry));
      store.subscribe(() => { throw Error('bad listener'); });
      store.write('DEBUG', 'fixture', 'hidden'); store.write('INFO', 'fixture', 'visible', { token: 'synthetic' });
      assert.equal(observed.length, 1); assert.equal(store.recent(1)[0].message, 'visible');
      assert.equal(store.recent(1)[0].context.token, '[REDACTED]');
      unsubscribe(); store.write('WARN', 'fixture', 'after-unsubscribe'); assert.equal(observed.length, 1);
      store.flush(); assert.equal(store.pending.length, 0); assert.equal(store.pendingBytes, 0);
      const logs = path.join(directory, 'logs'); const main = path.join(logs, 'alune-2026-11-09.log');
      assert.deepEqual(fs.readFileSync(main, 'utf8').trim().split('\n').map(line => JSON.parse(line).message), ['visible', 'after-unsubscribe']);
      store.append(JSON.stringify({ time: new Date(2026, 10, 9, 12).toISOString(), level: 'INFO', source: 'direct', message: 'direct-append' }) + '\n');
      store.loadHistory(); assert.equal(store.recent(1)[0].message, 'direct-append');
      const logLimits = require('@alune/protocol').LOGGING_LIMITS;
      store.file.size = logLimits.fileMB * 1024 * 1024;
      const rotated = store.target(1); assert.equal(rotated.index, 1); assert.equal(rotated.path, path.join(logs, 'alune-2026-11-09.1.log'));
      const expired = path.join(logs, 'alune-2000-01-01.log'), foreign = path.join(logs, 'keep.txt');
      fs.writeFileSync(expired, 'old'); fs.writeFileSync(foreign, 'preserve'); store.cleanup();
      assert.equal(fs.existsSync(expired), false); assert.equal(fs.readFileSync(foreign, 'utf8'), 'preserve');
      const custom = path.join(directory, 'custom');
      assert.equal(store.update({ level: 'WARN', retentionDays: 7, maxTotalMB: 100, customDirectory: custom }).directory, custom);
      assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'logging.json'), 'utf8')).level, 'WARN');
      store.close(); store.close(); store.write('ERROR', 'fixture', 'after-close'); assert(!store.recent().some(x => x.message === 'after-close'));
    } finally { store.close(); }
  }
});

test('P0 log redaction direct registration, text and nested context retain secret suppression', () => {
  const a = old('logging/redact'), b = next('adapters/logging');
  for (const mod of [a, b]) {
    mod.registerSecret('synthetic-registered-credential');
    assert(!mod.redactText('failed synthetic-registered-credential').includes('synthetic-registered-credential'));
    assert.equal(mod.redactText('literal-safe'), 'literal-safe');
    const context = mod.redactContext({ token: 'synthetic', safe: 'literal', nested: { password: 'hidden' } });
    assert.equal(context.token, '[REDACTED]'); assert.equal(context.nested.password, '[REDACTED]'); assert.equal(context.safe, 'literal');
  }
  pairs(a.redactText, b.redactText, ['Authorization: Bearer synthetic-secret', 'https://user:password@host.invalid/path', 'safe'].map(x => [x]));
});

test('P0 PR mutation, revision, permission and code payload contracts retain exact refusal states', () => {
  const a = old('repository/pull-request-actions'), b = next('modules/reviews/pull-request-actions');
  const value = { head: { sha: 'a'.repeat(40), ref: 'topic' }, base: { sha: 'b'.repeat(40), ref: 'main' }, state: 'open', mergeable: true, mergeable_state: 'clean', user: { login: 'actor' } };
  pairs(a.requestRevision, b.requestRevision, [[value, 'github'], [{}, 'github'], [{ diff_refs: { head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40) }, target_branch: 'main', source_branch: 'topic' }, 'gitlab']]);
  assert.equal(b.requestRevision(value, 'github').length, 64);
  pairs(a.assertRevision, b.assertRevision, [[value, { provider: 'github', revision: b.requestRevision(value, 'github') }], [value, { provider: 'github', revision: 'stale' }]]);
  const mutation = { action: 'comment', operationId: 'a'.repeat(36), revision: 'b'.repeat(64), body: 'literal' };
  pairs(a.validateMutation, b.validateMutation, [mutation, { ...mutation, body: '' }, { ...mutation, action: 'close' }, { ...mutation, action: 'merge', body: undefined, method: 'squash' }, { ...mutation, position: { path: 'f', side: 'RIGHT', startLine: 2, endLine: 1, filePage: 1 } }].map(x => [x]));
  const project = { permissions: { push: true }, allow_merge_commit: true, allow_squash_merge: true };
  for (const authenticated of [true, false]) for (const change of [{}, { draft: true }, { mergeable: false }, { state: 'closed' }, { mergeable: null }]) {
    const args = [{ ...value, ...change }, project, { login: 'actor' }, 'github', authenticated];
    assert.deepEqual(b.requestActions(...args), a.requestActions(...args));
  }
  assert.equal(b.requestActions(value, project, { login: 'actor' }, 'github', true).merge.allowed, true);
  assert.equal(b.requestActions(value, project, {}, 'github', false).merge.allowed, false);
  const query = { ...mutation, provider: 'github', position: { path: 'f', side: 'RIGHT', startLine: 1, endLine: 1, filePage: 1 } };
  const file = { path: 'f', patch: '@@ -1 +1 @@\n-before\n+after\n' };
  pairs(a.codeCommentPayload, b.codeCommentPayload, [[query, value, file], [query, value, { ...file, notice: 'incomplete' }], [{ ...query, provider: 'gitlab' }, { diff_refs: { base_sha: 'b', head_sha: 'a', start_sha: 'c' } }, file]]);
  assert.deepEqual(b.codeCommentPayload(query, value, file), { body: 'literal', commit_id: value.head.sha, path: 'f', side: 'RIGHT', line: 1 });
});

test('P0 proxy direct revision and credential snapshots preserve target binding and corrupt-state refusal', () => {
  const stores = [new (old('proxy/proxy-settings').ProxySettingsStore)(path.join(temp, 'proxy.json'), secrets), new (next('modules/settings/proxy').ProxySettingsStore)(document(), secrets, errors)];
  const snapshots = [];
  for (const store of stores) {
    const before = store.read(); store.assertRevision(before.revision);
    assert.throws(() => store.assertRevision('stale'), /已变化/);
    store.save({ ...before, enabled: true, host: 'proxy.invalid', port: 3128, authEnabled: true, credentials: { action: 'replace', username: 'fixture', password: 'synthetic' } });
    assert.deepEqual(store.snapshot().credentials, { username: 'fixture', password: 'synthetic' });
    assert.equal(store.read().hasCredentials, true);
    assert(!JSON.stringify(store.read()).includes('synthetic'));
    const good = store.read();
    assert.throws(() => store.save({ ...good, host: 'other.invalid' }), /重新|认证/);
    assert.deepEqual(store.read(), good);
    store.save({ ...good, authEnabled: false, credentials: { action: 'clear' } });
    assert.equal(store.snapshot().credentials, undefined);
    snapshots.push({ ...store.snapshot(), revision: '<opaque>' });
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
  const corrupt = new (next('modules/settings/proxy').ProxySettingsStore)({ read() { throw Error('broken'); } }, secrets, errors);
  assert.throws(() => corrupt.snapshot(), /不会回退直连/);
});

test('P0 terminal registry direct locking, matching and confirmed removal preserve repository ownership', async () => {
  for (const registry of [new (old('terminal/terminal-registry').TerminalRegistry)(), new (next('modules/terminals/registry').TerminalRegistry)((message, sessions) => Object.assign(Error(message), { sessions }))]) {
    const closed = [];
    for (const [id, repositoryId, connectionId, state] of [['a', 'r1', 'c1', 'running'], ['b', 'r1', 'c1', 'exited'], ['c', 'r2', 'c1', 'connecting'], ['d', 'r3', 'c2', 'running']]) registry.entries.set(id, { info: { id, repositoryId, connectionId, state }, close: () => closed.push(id) });
    assert.deepEqual(registry.matching({ repositoryId: 'r1' }).map(x => x.info.id), ['a', 'b']);
    assert.deepEqual(registry.matching({ connectionId: 'c1' }).map(x => x.info.id), ['a', 'b', 'c']);
    assert.equal(registry.matching({}).length, 4);
    assert.throws(() => registry.assertRemovable({ repositoryId: 'r1' }), /1 个终端/);
    assert.throws(() => registry.remove({ repositoryId: 'r1' }, ['c']), /确认/);
    assert.deepEqual(closed, []);
    registry.remove({ repositoryId: 'r1' }, ['a']); assert.deepEqual(closed, ['a', 'b']);
    registry.entries.delete('a'); registry.entries.delete('b');
    await assert.rejects(registry.withoutTerminals(['r1'], async () => { assert.throws(() => registry.assertAvailable('r1'), /正在移除/); registry.assertAvailable('r2'); throw Error('controlled failure'); }), /controlled failure/);
    registry.assertAvailable('r1');
    assert.equal(await registry.withoutTerminals(['r1'], async () => 42), 42);
    registry.assertAvailable('missing');
  }
});

test('P0 PR remote, query and creation validators preserve literal values and invalid boundaries', () => {
  const a = old('repository/pull-request-remote').pullRequestRemote, b = next('modules/reviews/pull-request-remote').pullRequestRemote;
  pairs(a, b, ['git@github.com:team/repo.git', 'https://u:synthetic@code.example/team/repo.git', 'ssh://git@code.example:2222/team/repo', 'git@alias:team/repo', 'https://code.example/team/%2e%2e/repo', 'file:///repo', 'bad\nurl'].map(fetchUrl => [{ name: 'origin', fetchUrl, pushUrl: 'https://different.invalid/x/y' }]));
  assert.equal(b({ name: 'origin', fetchUrl: 'git@github.com:team/repo.git' }).webUrl, 'https://github.com/team/repo');
  const query = { remote: 'origin', target: 'https://github.com/team/repo', provider: 'github', state: 'open', page: 1 };
  for (const name of ['validatePullRequestQuery', 'validatePullRequestDetailQuery']) {
    pairs(old('repository/pull-requests.service')[name], next('modules/reviews/pull-requests.service')[name], [null, {}, query, { ...query, page: 0 }, { ...query, number: 1 }, { ...query, token: 'bad token', number: 1 }, { ...query, number: -1 }].map(value => [value]));
  }
  const creation = { ...query, sourceBranch: 'topic', targetBranch: 'main', title: 'Fixture', description: '', draft: true, revision: 'a'.repeat(64), operationId: 'a'.repeat(36) };
  for (const name of ['validateCreation', 'validateCreate']) pairs(old('repository/pull-request-creation.service')[name], next('modules/reviews/pull-request-creation.service')[name], [creation, { ...creation, sourceBranch: 'main' }, { ...creation, title: 'bad\n' }, { ...creation, reviewers: ['bad,actor'] }, { ...creation, sourceBranch: '-option' }, { ...creation, revision: 'stale' }].map(value => [value]));
  const center = { view: 'all', state: 'open', provider: '', account: '', search: ' Search ', projects: ['b', 'a', 'b'] };
  pairs(old('repository/pull-request-center.service').centerQuery, next('modules/reviews/pull-request-center.service').centerQuery, [center, null, { ...center, view: 'bad' }, { ...center, projects: [3] }].map(value => [value]));
  assert.deepEqual(next('modules/reviews/pull-request-center.service').centerQuery(center).projects, ['a', 'b']);
  pairs(old('repository/pull-request-center.service').centerProjectKey, next('modules/reviews/pull-request-center.service').centerProjectKey, [['github', 'CODE.EXAMPLE', 'Team/Repo'], ['gitlab', 'code.example', 'team/repo']]);
  assert.equal(next('modules/reviews/pull-requests.service').PULL_REQUEST_TIMEOUT_MS, 20000);
});

test('P0 PR content normalization preserves complete, partial, binary and discussion projections', () => {
  const a = old('repository/pull-request-content'), b = next('modules/reviews/pull-request-content');
  for (const name of ['text', 'count']) pairs(a[name], b[name], [null, undefined, '', 'literal', 0, 1, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].map(x => [x]));
  const patch = '@@ -1 +1 @@\n-before\n+after\n';
  const files = [{ filename: 'literal 中文', status: 'modified', additions: 1, deletions: 1, patch }, { filename: 'f', patch: '@@ -1,9 +1,9 @@\n+x' }, { filename: 'f', patch: 'Binary files a and b differ' }, { filename: 'f', patch: 'x'.repeat(200001) }, { filename: 'new', previous_filename: 'old', status: 'renamed' }, {}];
  pairs(a.normalizeFile, b.normalizeFile, files.map(x => [x, 'github']).concat([[{ old_path: 'a', new_path: 'b', renamed_file: true, diff: patch }, 'gitlab']]));
  const exact = b.normalizeFile(files[0], 'github'); assert.equal(exact.notice, undefined); assert.equal(exact.patch, patch); assert.equal(exact.additions, 1);
  pairs(a.normalizeDiscussion, b.normalizeDiscussion, [[{ id: 1, user: { login: 'actor' }, body: 'literal <script>', created_at: '2020-01-01', path: 'f', line: null, original_line: 2 }, 'github', 'comments'], [{ id: 'thread', notes: [{ id: 2, body: 'note', resolvable: true, resolved: false }] }, 'gitlab', 'comments'], [{ id: '', notes: [] }, 'gitlab', 'comments'], [{ id: 1, created_at: 'not-a-date' }, 'github', 'reviews']]);
});

test('P0 AI response parsing and prompt bounds preserve exact content and invalid responses', () => {
  const a = old('ai/ai-provider').parseCommit, b = next('adapters/providers/ai-provider').parseCommit;
  pairs(a, b, ['{"message":" fix: literal ","description":" body "}', '```json\n{"message":"ok","description":""}\n```', '{}', 'bad', '{"message":"bad\\nline","description":""}', JSON.stringify({ message: 'x'.repeat(201), description: '' })].map(x => [x]));
  assert.deepEqual(b('{"message":" fix: literal ","description":" body "}'), { message: 'fix: literal', description: 'body' });
  const x = old('ai/pull-request-prompt'), y = next('modules/ai/pull-request-prompt');
  pairs(x.parsePullRequest, y.parsePullRequest, ['{"title":" Title ","description":" Body "}', '{}', 'bad', JSON.stringify({ title: 'x', description: 'x'.repeat(12001) })].map(x => [x]));
  const preview = { sourceBranch: 'topic', targetBranch: 'main', template: '\\"'.repeat(12000), commits: Array.from({ length: 20 }, (_, i) => ({ hash: String(i), message: 'x'.repeat(2100) })), files: Array.from({ length: 20 }, (_, i) => ({ path: 'f' + i, status: 'modified', patch: 'a'.repeat(9000) })) };
  assert.deepEqual(y.pullRequestPrompt(preview), x.pullRequestPrompt(preview));
  assert(JSON.stringify(y.pullRequestPrompt(preview)).length <= 60000); assert.equal(y.pullRequestPrompt(preview).truncated, true);
});

test('P0 SSH proxy and shell builders preserve quoting, local addresses and fail-closed override reads', async () => {
  const a = frozen('packages/ssh-client/src/proxy-git.ts'), b = next('adapters/ssh/proxy-git');
  pairs(a.isLoopbackAddress, b.isLoopbackAddress, ['127.0.0.1', '127.2.3.4', '::ffff:127.0.0.1', '::1', 'localhost', '128.0.0.1', '127.0.0.1.evil', '192.168.0.1'].map(x => [x]));
  assert.equal(b.isLoopbackAddress('192.168.0.1'), false);
  for (const port of [1, 3128, 65535]) assert.equal(b.sshProxyCommand(port), a.sshProxyCommand(port));
  for (const mod of [a, b]) {
    const calls = [], connection = { execCommand: async (...args) => { calls.push(args); return { exitCode: 0, stdout: 'http.https://host.invalid.proxy\nremote.origin.proxy\n', stderr: '' }; } };
    const command = await mod.proxyGitArguments(connection, "/repo literal ' 中文", ['fetch', 'origin'], 3128);
    assert.equal(calls.length, 1); assert.match(command, /NO_PROXY/); assert.match(command, /protocol.allow=never/); assert.match(command, /http:\/\/127.0.0.1:3128/);
    connection.execCommand = async () => ({ exitCode: 2, stdout: '', stderr: 'controlled failure' });
    await assert.rejects(mod.proxyGitArguments(connection, '/repo', ['fetch'], 3128), /已中止网络操作/);
    assert(new mod.GitProxyError('fixture') instanceof Error);
  }
  pairs(frozen('packages/ssh-client/src/terminal-shell.ts').terminalShellCommands, next('adapters/ssh/terminal-shell').terminalShellCommands, ['', 'relative', '/repo literal\n中文', "C:/repo ' literal", '//server/share/repo', '/repo\0bad'].map(x => [x]));
});
