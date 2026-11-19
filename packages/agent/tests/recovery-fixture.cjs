const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openProtectedSecrets } = require('../dist/adapters/secrets/protected');
const { initializeAgentAccessTokens } = require('../dist/adapters/sqlite/access-tokens');
const { AccessTokensStore, HostProfilesStore, initializeHostProfiles } = require('../dist/modules/accounts');
const { RepositoryCatalog } = require('../dist/modules/repositories/catalog');
const { AiSettingsStore, ProxySettingsStore } = require('../dist/modules/settings');

async function seedRecoveryState(state, secretOptions) {
  const cipher = await openProtectedSecrets(
    state.root,
    state.agentId,
    state.document('credential-key'),
    { ...secretOptions, allowInitialize: true },
  );
  try {
    initializeHostProfiles(state.database);
    const hosts = new HostProfilesStore(state.database, cipher);
    const { hosts: [host] } = hosts.save(null, {
      name: 'Fixture host',
      host: 'fixture.invalid',
      port: 22,
      username: 'fixture',
      authType: 'password',
      privateKeyPath: null,
      password: 'fixture-ssh-password',
    }, hosts.list().revision);
    const hostId = host.id;
    const catalog = new RepositoryCatalog(state.database, state.agentId);
    const remoteResourceId = randomUUID();
    const { id: repoId } = catalog.bindHost(hostId, {
      id: remoteResourceId,
      resource: { agentId: randomUUID(), resourceId: remoteResourceId },
      source: 'local',
      name: 'Remote fixture',
      path: '/fixture/remote',
      worktreeKind: 'main',
    }, false);
    const { id: localId } = catalog.register(path.join(state.root, 'repository'), 'Local fixture', 'main');
    initializeAgentAccessTokens(state.database);
    const tokens = new AccessTokensStore(state.database, cipher);
    const { tokens: [token] } = tokens.save(null, {
      name: 'Fixture token',
      value: 'fixture-recovery-token',
      revision: tokens.list().revision,
    });
    const remote = {
      name: 'origin',
      host: 'fixture.invalid',
      project: 'team/repo',
      webUrl: 'https://fixture.invalid/team/repo',
      provider: 'gitlab',
    };
    tokens.apply(repoId, remote, {
      remote: remote.name,
      target: remote.webUrl,
      provider: remote.provider,
      tokenId: token.id,
      revision: tokens.list().revision,
    });
    const ai = new AiSettingsStore(state.document('ai-settings'), cipher);
    const first = ai.read(), provider = first.providers[0];
    ai.saveProvider(provider.id, {
      ...provider,
      enabled: true,
      apiKey: 'fixture-recovery-ai-key',
    }, first.revision);
    const proxy = new ProxySettingsStore(state.document('network-proxy'), cipher);
    proxy.save({
      ...proxy.read(),
      enabled: true,
      host: '127.0.0.1',
      authEnabled: true,
      credentials: { action: 'replace', username: 'fixture', password: 'fixture-recovery-proxy-password' },
    });
    const workspace = {
      version: 1,
      state: {
        repositorySession: { ids: [repoId, localId], activeId: localId },
        connectionOrder: [hostId],
        appearance: { theme: 'dark' },
      },
    };
    const preferences = state.document('workspace-preferences');
    preferences.read();
    preferences.write(workspace);
    return { hostId, repoId, remote, workspace };
  } finally {
    cipher.close();
  }
}

module.exports = { seedRecoveryState };
