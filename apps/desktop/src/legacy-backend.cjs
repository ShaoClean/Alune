// Temporary rollback entry until all P8/P9 platform checks have passed.
const path = require('node:path');
const os = require('node:os');
const { existsSync, writeFileSync, rmSync } = require('node:fs');
async function startLegacyBackend({ app, dataDir, smokeTest, token }) {
  const standaloneDatabase = path.join(os.homedir(), '.alune', 'alune.db');
  const databasePath = path.join(dataDir, 'alune.db');
  const tokenImportMarker = path.join(dataDir, 'access-token-import-pending');
  if (!smokeTest && !existsSync(databasePath) && existsSync(standaloneDatabase)) {
    const Database = require('better-sqlite3');
    const source = new Database(standaloneDatabase, { readonly: true });
    try {
      await source.backup(databasePath);
    } finally {
      source.close();
    }
    writeFileSync(tokenImportMarker, '', { mode: 0o600 });
  }
  const { startServer } = require('./server/bootstrap.js');
  const aiSecretStorage = require('./ai-secret-storage.cjs').createAiSecretStorage(
    require('electron').safeStorage,
  );
  if (!smokeTest && existsSync(tokenImportMarker)) {
    const Database = require('better-sqlite3');
    const imported = new Database(databasePath);
    try {
      const { readCheckedLegacySecretStorage } = require('./server/secrets/secret-storage');
      const {
        migrateImportedAccessTokens,
      } = require('./server/access-tokens/access-token-migration');
      const importController = new AbortController();
      const cancelImport = () => importController.abort();
      app.once('before-quit', cancelImport);
      let sourceSecrets;
      try {
        sourceSecrets = await readCheckedLegacySecretStorage(
          path.dirname(standaloneDatabase),
          importController.signal,
        );
        if (migrateImportedAccessTokens(imported, sourceSecrets, aiSecretStorage))
          rmSync(tokenImportMarker);
      } catch (error) {
        if (importController.signal.aborted) return;
        throw error;
      } finally {
        sourceSecrets?.close?.();
        app.off('before-quit', cancelImport);
      }
    } finally {
      imported.close();
    }
  }
  const backend = await startServer({
    port: 0,
    host: '127.0.0.1',
    token,
    desktop: true,
    webRoot: path.join(__dirname, 'web'),
    aiSecretStorage,
  });
  const origin = await backend.getUrl();
  const { ProxyService } = require('./server/proxy/proxy.service.js');
  const networkProxy = backend.get(ProxyService);
  return {
    backend,
    origin,
    networkProxy,
    registry: backend.get(require('./server/terminal/terminal-registry.js').TerminalRegistry),
  };
}
module.exports = {
  startLegacyBackend,
  appLog: () => require('./server/logging/logger.js'),
  registerSecret: (token) => require('./server/logging/redact.js').registerSecret(token),
};
