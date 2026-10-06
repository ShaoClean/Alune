const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startProxyFixture } = require('./proxy-fixture.cjs');
const { createMacUpdater } = require('../../desktop/src/mac-updater.cjs');
const { AiService } = require('../dist/ai/ai.service');
const { GitService } = require('../dist/git/git.service');

(async () => {
  const fixture = await startProxyFixture();
  const { proxy, proxies, credentials, connection, connections, app } = fixture;
  const call = async (pathname, body, method = 'POST') => {
    const response = await fetch(`${fixture.origin}/api/${pathname}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`); return value;
  };
  const save = (protocol, patch = {}) => proxy.settings.save({ ...proxy.settings.read(), enabled: true, protocol, host: '127.0.0.1', port: proxies[protocol].port, authEnabled: true, credentials: { action: 'replace', ...credentials }, ...patch });
  try {
    for (const protocol of ['http', 'https', 'socks5']) {
      const config = save(protocol);
      const test = await call('network-proxy/test', { kind: 'http', revision: config.revision, url: `http://ai.fixture.test:${fixture.ai.port}/v1/models` });
      assert.equal(test.success, true, JSON.stringify(test));
      assert.ok(proxies[protocol].records.some((entry) => entry.host === 'ai.fixture.test'));
      const ssh = await call('network-proxy/test', { kind: 'ssh', revision: config.revision, connectionId: connection.id });
      assert.equal(ssh.success, true, JSON.stringify(ssh));
    }
    const ai = app.get(AiService);
    const aiConfig = ai.settings.saveProvider(undefined, { name: 'Proxy fixture', protocol: 'openai', baseUrl: `http://ai.fixture.test:${fixture.ai.port}/v1`, enabled: true, apiKey: 'fixture-api-key', models: [{ id: 'fixture-model', name: 'Fixture', enabled: true }] }, ai.settings.read().revision);
    const provider = aiConfig.providers.find((item) => item.name === 'Proxy fixture');
    await ai.models(provider.id, ai.settings.read().revision, AbortSignal.timeout(10_000));
    await ai.test(provider.id, ai.settings.read().revision, AbortSignal.timeout(10_000));
    ai.settings.saveCommit({ ...ai.settings.read().commit, providerId: provider.id, modelId: 'fixture-model' }, ai.settings.read().revision);
    fs.writeFileSync(path.join(fixture.repo, 'README.md'), 'generated through proxy\n'); fixture.git(fixture.repo, 'add', '.');
    const generated = await ai.generate(fixture.repository.id, ai.settings.read().revision, AbortSignal.timeout(15_000));
    assert.equal(generated.message, 'feat: proxy fixture'); fixture.git(fixture.repo, 'reset', '--hard', 'HEAD');
    assert.equal(fixture.aiRequests.filter((item) => item.path.endsWith('/chat/completions')).length, 2);
    assert.ok(fixture.aiRequests.every((item) => !item.headers['proxy-authorization']));

    const adapter = createMacUpdater({ version: '0.4.0', arch: 'arm64', cacheDir: path.join(fixture.root, 'updates'), fetchImpl: proxy.fetch });
    assert.equal((await adapter.check(AbortSignal.timeout(10_000))).version, '0.5.0');
    const downloaded = await adapter.download(AbortSignal.timeout(10_000), () => {});
    assert.equal(fs.readFileSync(downloaded, 'utf8'), 'controlled-update-payload');
    assert.ok(fixture.urls.some((item) => item.path.endsWith('SHA256SUMS')));
    for (const host of ['api.github.com', 'github.com', 'release-assets.githubusercontent.com']) assert.ok(proxies.socks5.records.some((entry) => entry.host === host), host);

    let ssh;
    const git = app.get(GitService);
    // Each operation must use the latest app settings, without an SSH reconnect.
    for (const protocol of ['http', 'https', 'socks5']) {
      save(protocol);
      for (const [kind, remote] of [['https', fixture.httpsRemote], ['ssh', fixture.sshRemote]]) {
        fixture.git(fixture.repo, 'remote', 'set-url', 'origin', remote);
        fs.writeFileSync(path.join(fixture.seed, 'README.md'), `remote update for ${protocol}/${kind}\n`);
        fixture.git(fixture.seed, 'add', '.');
        fixture.git(fixture.seed, 'commit', '-qm', `fixture ${protocol}/${kind}`);
        fixture.git(fixture.seed, 'push', path.join(fixture.root, 'remote.git'), 'main');
        const remoteHead = fixture.git(fixture.seed, 'rev-parse', 'HEAD').trim();
        for (const repository of [fixture.localRepository, fixture.localLinked]) {
          const branch = `local-${protocol}-${kind}-${repository === fixture.localRepository ? 'main' : 'worktree'}`;
          for (const [operation, run] of [
            ['fetch', () => git.fetch(repository.id, 'origin')],
            ['pull', () => git.pull(repository.id, 'origin', 'main')],
            ['push', () => git.push(repository.id, 'origin', branch, false, true)],
            ['ls-remote', () => git.tags(repository.id, 'origin')],
          ]) {
            const before = proxies[protocol].records.length;
            const result = await run();
            assert.ok(proxies[protocol].records.slice(before).some((entry) => entry.host === 'git.fixture.test'), `${protocol}/${kind}/${repository.name}/${operation}: local Git routes through the current app proxy`);
            if (operation === 'fetch') assert.equal(fixture.git(repository.path, 'rev-parse', 'refs/remotes/origin/main').trim(), remoteHead);
            if (operation === 'pull') assert.equal(fixture.git(repository.path, 'rev-parse', 'HEAD').trim(), remoteHead);
            if (operation === 'ls-remote') assert.ok(result.some((tag) => tag.name === 'fixture-v1'));
          }
          assert.equal(fixture.git(path.join(fixture.root, 'remote.git'), 'rev-parse', `refs/heads/${branch}`).trim(), fixture.git(repository.path, 'rev-parse', 'HEAD').trim(), 'push reaches the real Git backend');
        }
      }
    }
    // Disabling restores ordinary Git behavior and retains repository settings.
    fixture.git(fixture.repo, 'remote', 'set-url', 'origin', fixture.directRemote);
    save('http', { enabled: false, credentials: { action: 'keep' } });
    const directBefore = fixture.gitRequests.length;
    const proxyBefore = Object.values(proxies).map((entry) => entry.records.length);
    await git.fetch(fixture.localRepository.id, 'origin');
    assert.ok(fixture.gitRequests.length > directBefore, 'disabled app proxy permits configured direct Git access');
    assert.deepEqual(Object.values(proxies).map((entry) => entry.records.length), proxyBefore);
    // The destination is directly reachable: authentication failure must not fall back.
    save('http', { credentials: { action: 'replace', username: credentials.username, password: 'wrong' } });
    const failedBefore = fixture.gitRequests.length;
    await assert.rejects(git.fetch(fixture.localRepository.id, 'origin'));
    assert.equal(fixture.gitRequests.length, failedBefore, 'failed app proxy never retries directly');
    save('http');
    const restoredBefore = proxies.http.records.length;
    await git.fetch(fixture.localRepository.id, 'origin');
    assert.ok(proxies.http.records.length > restoredBefore, 'new credentials take effect on the next local operation');
    for (const protocol of ['http', 'https', 'socks5']) {
      const configuration = save(protocol);
      await connections.reconnectProxy(connection.id, configuration.revision);
      ssh = await connections.ensureConnected(connection.id); await ssh.prepareGitProxy();
      assert.equal(ssh.forwarding, 'ready');
    for (const [kind, remote] of [['https', fixture.httpsRemote], ['ssh', fixture.sshRemote]]) {
      fixture.git(fixture.repo, 'remote', 'set-url', 'origin', remote);
      for (const repository of [fixture.repository, fixture.linked]) {
        const before = proxies[protocol].records.length;
        await git.fetch(repository.id, 'origin');
        await git.pull(repository.id, 'origin', 'main');
        await git.push(repository.id, 'origin', `proxy-${protocol}-${kind}-${repository === fixture.repository ? 'main' : 'worktree'}`, false, true);
        assert.ok(proxies[protocol].records.length >= before + 3, `${kind}: every Git process routes through proxy`);
        const tested = await call('network-proxy/test', { kind: 'git', revision: proxy.settings.read().revision, connectionId: connection.id, repositoryId: repository.id });
        assert.equal(tested.success, true, JSON.stringify(tested));
      }
    }
    }
    assert.equal(fixture.git(fixture.repo, 'config', 'http.proxy').trim(), 'http://unreachable.invalid:1');
    assert.equal(fixture.git(fixture.repo, 'config', 'remote.origin.proxy').trim(), '');
    assert.ok(fixture.remote.commands.every((command) => !command.includes(credentials.username) && !command.includes(credentials.password)));
    const oldRevision = ssh.proxyRevision;
    const latest = save('http');
    assert.equal((await connections.proxyStatuses())[0].pendingReconnect, true);
    const release = ssh.holdTask();
    await assert.rejects(connections.reconnectProxy(connection.id, latest.revision), /运行中任务/); release();
    assert.equal(ssh.connected, true);
    // A reconnect caused by transport loss retains its original immutable snapshot.
    for (const client of fixture.remote.clients) client.end();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await connections.ensureConnected(connection.id);
    assert.equal(ssh.proxyRevision, oldRevision); assert.equal((await connections.proxyStatuses())[0].pendingReconnect, true);
    await connections.reconnectProxy(connection.id, latest.revision);
    const replacement = connections.getConnection(connection.id); await replacement.prepareGitProxy();
    assert.equal(replacement.proxyRevision, latest.revision);
    const disabled = save('http', { enabled: false, credentials: { action: 'keep' } });
    assert.equal((await connections.proxyStatuses())[0].pendingReconnect, true);
    await connections.reconnectProxy(connection.id, disabled.revision);
    assert.equal(connections.getConnection(connection.id).forwarding, 'disabled');
    const failed = save('http', { credentials: { action: 'replace', username: credentials.username, password: 'wrong' } });
    const failedTest = await call('network-proxy/test', { kind: 'http', revision: failed.revision, url: `http://ai.fixture.test:${fixture.ai.port}/v1/models` });
    assert.equal(failedTest.success, false); assert.match(failedTest.message, /认证/);
    console.log('PROXY_INTEGRATION_PASSED');
  } finally { await fixture.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
