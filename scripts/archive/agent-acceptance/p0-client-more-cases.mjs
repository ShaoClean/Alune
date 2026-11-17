// Explicit follow-up oracles for the 61 still-live original client IDs.
// These helpers only wrap literal fixtures; they never inspect source or actual results.
const resource = { agentId: 'local-agent', resourceId: 'repo-1' };
const alias = { id: 'repo-1', resource: { agentId: 'local-agent', resourceId: 'repo-1' }, name: 'Fixture', path: '/workspace/repo', source: 'local', pinned: false };
export const writeRevision = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const fileToken = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const fixedTime = 1700000000000;
const rpc = (method, params, response, options, host = 'local-agent') => ({ host, method, params, response, options });
const lookup = () => rpc('repositories.get', { resource }, alias);
const row = (entryId, invoke, requests, expected, options = {}) => ({ entryId, testName: entryId + ' exact contract', invoke, requests, expected, setup: [], ...options });
const writeSteps = (kind, args, response) => [lookup(),
  rpc('repositories.prepareWrite', { resource, kind, args }, { revision: writeRevision }, { timeoutMs: 125000 }),
  rpc('repositories.write', { resource, kind, args, revision: writeRevision, operationId: '$operationId' }, response, { timeoutMs: 310000 })];
const writeCase = (id, invoke, kind, args, response = { success: true }, expected = response) => row(id, invoke, writeSteps(kind, args, response), expected, { errorAt: 2, writeKind: kind });
const linked = { id: 'repo-linked', resource: { agentId: 'local-agent', resourceId: 'repo-linked' }, name: 'Linked', path: '/workspace/linked', source: 'local', pinned: false };
export const profile = { id: 'host-1', name: 'Fixture host', host: 'fixture.invalid', port: 2222, username: 'tester', authType: 'sshAgent', privateKeyPath: null, hasPassword: false, hasPassphrase: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' };
const profiles = { revision: 'hosts-r1', hosts: [profile], secretStorage: { available: true, description: 'fixture' } };
export const hostRoute = { hostId: 'host-1', hostKey: 'a'.repeat(64), state: 'ready', reason: null, gitProxy: 'blocked', proxyRevision: 'proxy-old', activeTasks: 3, updatedAt: 123, bindings: [{ localId: 'alias-1', resource: { agentId: 'remote-agent', resourceId: 'remote-repo' } }] };
const catalog = () => rpc('hosts.catalog', {}, { hosts: [hostRoute] });
const listProfiles = () => rpc('accounts.hosts.list', undefined, profiles, {});
const proxy = { revision: 'proxy-r2', enabled: false, protocol: 'http', host: '', port: 8080, authEnabled: false, hasCredentials: false, secretStorageAvailable: true };
const proxyConnections = [{ id: 'host-1', name: 'Fixture host', connected: true, connecting: false, revision: 'proxy-old', pendingReconnect: true, activeTasks: 3, forwarding: 'denied' }];
const proxyConnectionSteps = () => [listProfiles(), catalog(), rpc('settings.proxy.get', undefined, proxy, {})];
export const topics = ['repositories.changed', 'accounts.hosts.changed', 'accounts.tokens.changed', 'hosts.changed', 'terminal:state', 'terminal:output', 'terminal:removed'];
export const remoteIdentity = { protocol: { major: 1, minor: 7 }, agentId: 'remote-agent', sessionId: 'remote-session', implementation: { name: 'fixture-agent', version: '0.0.1' }, capabilities: [], lifecycle: 'session' };
export const remoteResource = { agentId: 'remote-agent', resourceId: 'remote-repo' };
const remoteRepo = { id: 'remote-repo', resource: { agentId: 'remote-agent', resourceId: 'remote-repo' }, name: 'Remote', path: '/srv/repo', source: 'local', pinned: false };
const remoteAlias = { id: 'alias-1', resource: { agentId: 'local-agent', resourceId: 'alias-1' }, name: 'Remote', path: '/srv/repo', connectionId: 'host-1', source: 'ssh', pinned: false };
const remote = (method, params, response, options) => rpc(method, params, response, options, 'remote-agent');
const connectSteps = (revision) => [catalog(),
  rpc('hosts.open', { hostId: 'host-1', hostKey: 'a'.repeat(64), install: false, ...(revision ? { reconnectRevision: revision } : {}) }, { routeId: 'route-1' }, { timeoutMs: 190000 }),
  remote('repositories.list', undefined, [remoteRepo], {}),
  remote('events.subscribe', { topics }, { subscribed: topics, sessionId: 'remote-session' })];
const warm = () => [{ invoke: a => a.repo.scan('host-1', '/srv'), requests: [...connectSteps(), remote('repositories.discover', { path: '/srv', depth: 4 }, { paths: ['/srv/repo'] })] }];
const fileLocate = () => [rpc('repositories.list', undefined, [remoteAlias]), rpc('repositories.get', { resource: { agentId: 'local-agent', resourceId: 'alias-1' } }, remoteAlias), catalog()];
const remoteRead = (kind, params, value, options = { timeoutMs: 125000 }) => remote('repositories.read', { resource: remoteResource, kind, params }, { resource: remoteResource, kind, generation: 1, value }, options);
const connection = { ...profile, hasAuth: false, status: 'connected', updatedAt: 123, error: null };

export const moreCases = [
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.saveSigningConfig', a => a.git.saveSigningConfig('repo-1', { enabled: true, format: 'ssh', signingKey: '/keys/sign', tagEnabled: false }), 'saveSigningConfig', [{ enabled: true, format: 'ssh', signingKey: '/keys/sign', tagEnabled: false }], { enabled: true, format: 'ssh', signingKey: '/keys/sign', tagEnabled: false }, { enabled: true, format: 'ssh', signingKey: '/keys/sign', tagEnabled: false, source: 'local' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.createTag', a => a.git.createTag('repo-1', { name: 'v1', target: 'main', type: 'annotated', message: 'Release' }), 'createTag', [{ name: 'v1', target: 'main', type: 'annotated', message: 'Release' }]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.deleteTag', a => a.git.deleteTag('repo-1', { name: 'v1', objectHash: 'abc', confirmed: true, remote: 'upstream', remoteObjectHash: 'def' }), 'deleteTag', [{ name: 'v1', objectHash: 'abc', confirmed: true, remote: 'upstream', remoteObjectHash: 'def' }]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.pushTag', a => a.git.pushTag('repo-1', { remote: 'upstream', name: 'v1', all: false }), 'pushTag', [{ remote: 'upstream', name: 'v1', all: false }]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.checkoutTag', a => a.git.checkoutTag('repo-1', { name: 'v1', objectHash: 'abc', branch: 'release', confirmed: true }), 'checkoutTag', [{ name: 'v1', objectHash: 'abc', branch: 'release', confirmed: true }]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.startRebase', a => a.git.startRebase('repo-1', { base: 'main', token: 'plan-token', entries: [{ hash: 'abc', action: 'reword', message: 'Updated' }], acknowledgePublished: true }), 'startRebase', [{ base: 'main', token: 'plan-token', entries: [{ hash: 'abc', action: 'reword', message: 'Updated' }], acknowledgePublished: true }], { state: { managed: false, inProgress: false, conflicts: [] }, output: 'Rebased' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.controlRebase', a => a.git.controlRebase('repo-1', 'skip'), 'controlRebase', ['skip'], { state: { managed: false, inProgress: false, conflicts: [] }, output: 'Skipped' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.resolveRebaseConflict', a => a.git.resolveRebaseConflict('repo-1', { path: 'a.ts', token: 'conflict-token', choice: 'content', content: 'resolved\n' }), 'resolveRebaseConflict', [{ path: 'a.ts', token: 'conflict-token', choice: 'content', content: 'resolved\n' }], { managed: true, inProgress: true, conflicts: [] }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.ignoreDirectory', a => a.git.ignoreDirectory('repo-1', 'build/output'), 'ignoreDirectory', ['build/output']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.submodules', a => a.git.submodules('repo-1', 'sync'), 'submodules', ['sync']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.deepen', a => a.git.deepen('repo-1', 'upstream'), 'deepen', ['upstream']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.renameBranch', a => a.git.renameBranch('repo-1', 'topic', 'renamed'), 'renameBranch', ['topic', 'renamed']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.addRemote', a => a.git.addRemote('repo-1', 'upstream', 'ssh://fixture.invalid/repo'), 'addRemote', ['upstream', 'ssh://fixture.invalid/repo']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.saveAuthor', a => a.git.saveAuthor('repo-1', 'Fixture Author', 'fixture@example.invalid'), 'saveAuthor', ['Fixture Author', 'fixture@example.invalid']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.createWorktree', a => a.git.createWorktree('repo-1', '/workspace/linked', 'feature'), 'createWorktree', ['/workspace/linked', 'feature'], linked),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.removeWorktree', a => a.git.removeWorktree('repo-1', '/workspace/linked'), 'removeWorktree', ['/workspace/linked', true], { removedIds: ['repo-linked'] }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.mutateWorkspaceFile', a => a.git.mutateWorkspaceFile('repo-1', 'old.ts', 'preview-token', 'rename', 'new.ts'), 'mutateWorkspaceFile', ['old.ts', 'preview-token', 'rename', 'new.ts'], { success: true, newPath: 'new.ts' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.deleteNewFile', a => a.git.deleteNewFile('repo-1', 'new.ts', 'preview-token'), 'deleteNewFile', ['new.ts', 'preview-token']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.partialDiff', a => a.git.partialDiff('repo-1', { file: 'a.ts', action: 'stage', fullFile: false, revision: 'diff-r1', selection: { lines: [2, 4] } }), 'partialDiff', [{ file: 'a.ts', action: 'stage', fullFile: false, revision: 'diff-r1', selection: { lines: [2, 4] } }]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.stage', a => a.git.stage('repo-1', ['a.ts', 'space name.txt']), 'stage', [['a.ts', 'space name.txt']]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.unstage', a => a.git.unstage('repo-1', ['a.ts']), 'unstage', [['a.ts']]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.commit', a => a.git.commit('repo-1', 'fix: fixture', undefined, 'abc'), 'commit', ['fix: fixture', null, 'abc'], { hash: 'new-commit' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.push', a => a.git.push('repo-1', 'upstream', undefined, true, false, true), 'push', ['upstream', null, true, false, true]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.pull', a => a.git.pull('repo-1', 'upstream', 'main'), 'pull', ['upstream', 'main']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.fetch', a => a.git.fetch('repo-1'), 'fetch', []),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.createBranch', a => a.git.createBranch('repo-1', 'feature', false), 'createBranch', ['feature', false]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.switchBranch', a => a.git.switchBranch('repo-1', 'upstream/topic', undefined, true), 'switchBranch', ['upstream/topic', null, true], { success: true, branch: 'topic', stdout: 'Switched' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.deleteBranch', a => a.git.deleteBranch('repo-1', 'obsolete', true), 'deleteBranch', ['obsolete', true]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.merge', a => a.git.merge('repo-1', 'feature'), 'merge', ['feature']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.rebase', a => a.git.rebase('repo-1', 'upstream/main'), 'rebase', ['upstream/main']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.stash', a => a.git.stash('repo-1', undefined, true), 'stash', [null, true]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.stashPop', a => a.git.stashPop('repo-1', 2), 'stashPop', [2]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.stashApply', a => a.git.stashApply('repo-1', 3), 'stashApply', [3]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.stashDrop', a => a.git.stashDrop('repo-1', 4), 'stashDrop', [4]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.checkout', a => a.git.checkout('repo-1', ['a.ts', 'b.ts']), 'checkout', [['a.ts', 'b.ts']]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.discardChanges', a => a.git.discardChanges('repo-1', 'discard-token', 'all'), 'discardChanges', ['discard-token', 'all'], { success: true, restored: 1, deleted: 1, remaining: 0, unknown: 0 }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.reset', a => a.git.reset('repo-1', 'mixed', 'HEAD~2'), 'reset', ['mixed', 'HEAD~2']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.cherryPick', a => a.git.cherryPick('repo-1', ['abc', 'def']), 'cherryPick', [['abc', 'def']]),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.revert', a => a.git.revert('repo-1', 'abc'), 'revert', ['abc']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.continueOperation', a => a.git.continueOperation('repo-1'), 'continueOperation', [], { success: true, conflicts: false, message: 'Completed' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.skipOperation', a => a.git.skipOperation('repo-1'), 'skipOperation', [], { success: true, conflicts: true, message: 'Next conflict' }),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.abortOperation', a => a.git.abortOperation('repo-1'), 'abortOperation', []),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.resolveConflictFile', a => a.git.resolveConflictFile('repo-1', 'a.ts', 'incoming'), 'resolveConflictFile', ['a.ts', 'incoming']),
  writeCase('client-api:apps/web/src/api/index.ts:gitApi.resolveConflictBlock', a => a.git.resolveConflictBlock('repo-1', 'a.ts', 2, 'both', 'expected text'), 'resolveConflictBlock', ['a.ts', 2, 'both', 'expected text']),
  row('client-api:apps/web/src/api/index.ts:gitApi.operation', a => a.git.operation('repo-1'), [lookup(), rpc('repositories.operation', { resource }, { operationId: '11111111-1111-4111-8111-111111111111', kind: 'push', startedAt: 123, cancelling: false })], { operationId: '11111111-1111-4111-8111-111111111111', kind: 'push', startedAt: 123, cancelling: false }),
  row('client-api:apps/web/src/api/index.ts:gitApi.cancel', a => a.git.cancel('repo-1', '11111111-1111-4111-8111-111111111111'), [lookup(), rpc('repositories.cancelWrite', { resource, operationId: '11111111-1111-4111-8111-111111111111' }, { cancelling: true })], { cancelling: true }),
  row('client-api:apps/web/src/api/index.ts:repositoryApi.openSubmodule', a => a.repo.openSubmodule('repo-1', 'vendor/lib'), [lookup(), rpc('repositories.openRelated', { resource, path: 'vendor/lib', kind: 'submodule' }, linked)], linked),
  row('client-api:apps/web/src/api/index.ts:repositoryApi.openWorktree', a => a.repo.openWorktree('repo-1', '/workspace/linked'), [lookup(), rpc('repositories.openRelated', { resource, path: '/workspace/linked', kind: 'worktree' }, linked)], linked),
  row('client-api:apps/web/src/api/index.ts:repositoryApi.analytics', (a,s) => a.repo.analytics(['repo-1'], true, false, s), [lookup(), rpc('repositories.analytics', { resources: [resource], collect: true, refresh: false }, [{ id: 'repo-1', resource, data: { daily: Array(180).fill(2), endDay: '2026-01-01' } }], { timeoutMs: 220000, signal: '$signal' })], [{ id: 'repo-1', resource, data: { daily: Array(180).fill(2), endDay: '2026-01-01' } }], { errorAt: 1, errorExpected: [{ id: 'repo-1', error: 'fixture denied' }] }),
  row('client-api:apps/web/src/api/index.ts:connectionApi.list', a => a.connections.list(), [listProfiles(), catalog()], [connection], { errorAt: 1, failureTail: true }),
  row('client-api:apps/web/src/api/index.ts:connectionApi.get', a => a.connections.get('host-1'), [listProfiles(), catalog()], connection, { errorAt: 1, failureTail: true }),
  row('client-api:apps/web/src/api/index.ts:connectionApi.create', a => a.connections.create({ name: 'Fixture host', host: 'fixture.invalid', port: 2222, username: 'tester', authType: 'sshAgent', privateKeyPath: '', password: undefined, passphrase: null }), [rpc('accounts.hosts.list', undefined, { ...profiles, hosts: [] }, {}), rpc('accounts.hosts.save', { id: null, profile: { name: 'Fixture host', host: 'fixture.invalid', port: 2222, username: 'tester', authType: 'sshAgent', privateKeyPath: null, passphrase: null }, revision: 'hosts-r1' }, profiles, {})], profile, { errorAt: 1 }),
  row('client-api:apps/web/src/api/index.ts:connectionApi.delete', a => a.connections.delete('host-1'), [listProfiles(), rpc('repositories.list', undefined, [remoteAlias, alias]), rpc('workspace.remove', { kind: 'host', id: 'host-1', sessions: [], revision: 'hosts-r1', repositories: ['alias-1'] }, { removedIds: ['alias-1'] })], undefined, { errorAt: 2 }),
  row('client-api:apps/web/src/api/index.ts:connectionApi.test', a => a.connections.test('host-1'), [remote('agent.health', undefined, { status: 'ok', agentId: 'remote-agent', sessionId: 'remote-session', lifecycle: 'session' })], { success: true, status: 'connected', updatedAt: fixedTime }, { setup: warm() }),
  row('client-api:apps/web/src/api/index.ts:repositoryApi.scan', a => a.repo.scan('host-1', '/srv/projects'), [...connectSteps(), remote('repositories.discover', { path: '/srv/projects', depth: 4 }, { paths: ['/srv/projects/a', '/srv/projects/b'] })], ['/srv/projects/a', '/srv/projects/b'], { errorAt: 4 }),
  row('client-api:apps/web/src/api/index.ts:repositoryApi.add', a => a.repo.add('host-1', '/srv/repo'), [...connectSteps(), remote('repositories.register', { path: '/srv/repo' }, remoteRepo), remote('repositories.list', undefined, [remoteRepo]), rpc('hosts.bindRepository', { resource: remoteResource }, remoteAlias)], remoteAlias, { errorAt: 4 }),
  row('client-api:apps/web/src/api/index.ts:fileApi.list', a => a.files.list('host-1', '/srv/repo/src'), [...fileLocate(), remoteRead('tree', { path: 'src' }, { path: 'src', entries: [{ path: 'src/a.ts', name: 'a.ts', kind: 'file' }, { path: 'src/lib', name: 'lib', kind: 'directory' }], total: 2 })], [{ name: 'a.ts', isFile: true, isDirectory: false, longname: 'a.ts' }, { name: 'lib', isFile: false, isDirectory: true, longname: 'lib' }], { setup: warm(), errorAt: 3 }),
  row('client-api:apps/web/src/api/index.ts:fileApi.read', a => a.files.read('host-1', '/srv/repo/a.ts'), [...fileLocate(), remoteRead('file', { path: 'a.ts' }, { path: 'a.ts', kind: 'text', content: 'hello', size: 5, encoding: 'utf-8' })], { content: 'hello' }, { setup: warm(), errorAt: 3 }),
  row('client-api:apps/web/src/api/index.ts:fileApi.write', a => a.files.write('host-1', '/srv/repo/a.ts', 'updated\n'), [...fileLocate(), remoteRead('previewWorkspaceFile', { path: 'a.ts' }, { token: fileToken, canModify: true }), remote('repositories.prepareWrite', { resource: remoteResource, kind: 'writeFile', args: ['a.ts', 'updated\n', fileToken] }, { revision: writeRevision }, { timeoutMs: 125000 }), remote('repositories.write', { resource: remoteResource, kind: 'writeFile', args: ['a.ts', 'updated\n', fileToken], operationId: '$operationId', revision: writeRevision }, { success: true }, { timeoutMs: 310000 })], { success: true }, { setup: warm(), errorAt: 5, writeKind: 'writeFile' }),
  row('client-api:apps/web/src/api/proxy.ts:proxyApi.connections', a => a.proxy.connections(), proxyConnectionSteps(), proxyConnections, { errorAt: 2, failureTail: true }),
  row('client-api:apps/web/src/api/proxy.ts:proxyApi.reconnect', a => a.proxy.reconnect('host-1', 'proxy-r2'), [rpc('settings.proxy.get', undefined, proxy, {}), ...connectSteps('proxy-r2'), ...proxyConnectionSteps()], proxyConnections, { errorAt: 1 }),
];
