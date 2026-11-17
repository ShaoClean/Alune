import { randomUUID } from 'node:crypto';
import type { AgentState } from '../../adapters/sqlite/state';
import {
  captureLegacySource,
  verifyLegacySource,
  type LegacySnapshot,
} from '../../adapters/migration/legacy-source';
import {
  openProtectedSecrets,
  type ProtectedSecretOptions,
} from '../../adapters/secrets/protected';
import { readLegacySecretStorage } from '../../adapters/secrets/file';
import { StateFault, type SecretCipher } from '../../ports/state';
import { AiSettingsStore, ProxySettingsStore } from '../settings';
import { validateHostInput, encryptHostCredential, tokenValue } from '../accounts';
import { validateLoggingSettings } from '../../adapters/logging';
import { isRecord, validId, type SaveHostProfile } from '@alune/protocol';

export interface LegacyImportReceipt {
  importId: string;
  fingerprint: string;
  sourceBackupId: string;
  stateBackupId: string;
  alreadyImported: boolean;
  counts: {
    hosts: number;
    repositories: number;
    tokens: number;
    bindings: number;
    documents: number;
    unresolvedReferences: number;
  };
}
export interface LegacyImportOptions {
  signal?: AbortSignal;
  secretOptions?: Pick<ProtectedSecretOptions, 'backend' | 'keychain'>;
  // Only a trusted old host can supply this private, local decryption port.
  decryptSafeStorage?: (ciphertext: string, signal?: AbortSignal) => Promise<string>;
}
function fail(message = 'Legacy data failed validation'): never {
  throw new StateFault('corrupt', message + '; source and backups were retained');
}
function string(value: unknown, max = 32768): string {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) fail();
  return value;
}
function id(value: unknown): string {
  if (!validId(value)) fail('Invalid legacy identity');
  return value;
}
function date(value: unknown): string {
  const text = string(value, 128);
  if (!Number.isFinite(Date.parse(text))) fail('Invalid legacy timestamp');
  return text;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail('Legacy schema has unsupported fields');
}
function web(value: unknown): string {
  const text = string(value, 8192);
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail();
  } catch {
    fail('Invalid legacy web target');
  }
  return text;
}
function readonlyDocument(value: unknown) {
  return {
    read: () => value,
    write() {
      throw Error('Read-only migration validation');
    },
  };
}

async function convert(
  snapshot: LegacySnapshot,
  cipher: SecretCipher,
  options: LegacyImportOptions,
) {
  const source = readLegacySecretStorage(snapshot.source);
  const decrypted = new Map<string, string>();
  async function decrypt(value: unknown) {
    const encrypted = string(value, 1400000);
    if (decrypted.has(encrypted)) return decrypted.get(encrypted)!;
    options.signal?.throwIfAborted();
    let plaintext: string;
    try {
      if (encrypted.startsWith('aes-gcm:')) plaintext = source.decrypt(encrypted);
      else if (encrypted.startsWith('safe-storage:') && options.decryptSafeStorage)
        plaintext = await options.decryptSafeStorage(encrypted, options.signal);
      else throw Error();
    } catch {
      options.signal?.throwIfAborted();
      throw new StateFault(
        'unavailable',
        'Legacy credentials require their original key or a trusted local host decryptor; no credential was replaced',
      );
    }
    if (Buffer.byteLength(plaintext) > 1024 * 1024) fail('Legacy credential is too large');
    decrypted.set(encrypted, plaintext);
    return plaintext;
  }
  try {
    const hosts = snapshot.rows.connections.map((row) => {
      keys(row, [
        'id',
        'name',
        'host',
        'port',
        'username',
        'auth_type',
        'password',
        'private_key_path',
        'passphrase',
        'created_at',
        'updated_at',
      ]);
      const profile: SaveHostProfile = {
        name: row.name as string,
        host: row.host as string,
        port: row.port as number,
        username: row.username as string,
        authType: row.auth_type as SaveHostProfile['authType'],
        privateKeyPath: (row.private_key_path ?? null) as string | null,
      };
      try {
        validateHostInput(profile);
      } catch {
        fail('Legacy host profile is invalid');
      }
      const hostId = id(row.id);
      const secret = (kind: 'password' | 'passphrase') => {
        const value = row[kind];
        if (value === null || value === undefined || value === '') return null;
        const text = string(value, 65536);
        return encryptHostCredential(cipher, hostId, profile, kind, text);
      };
      return {
        id: hostId,
        profile,
        password: secret('password'),
        passphrase: secret('passphrase'),
        createdAt: date(row.created_at),
        updatedAt: date(row.updated_at),
      };
    });
    const hostIds = new Set(hosts.map((host) => host.id));
    const repositories = snapshot.rows.repositories.map((row) => {
      keys(row, [
        'id',
        'connection_id',
        'source',
        'name',
        'path',
        'pinned',
        'created_at',
        'worktree_kind',
      ]);
      const source = row.source ?? 'ssh';
      if (!['ssh', 'local'].includes(source as string) || ![0, 1, null].includes(row.pinned as any))
        fail('Invalid legacy repository');
      const connectionId = row.connection_id == null ? null : id(row.connection_id);
      if (source === 'ssh' && (!connectionId || !hostIds.has(connectionId)))
        fail('Legacy repository host is missing');
      if (source === 'local' && connectionId !== null)
        fail('Local legacy repository has a remote host');
      if (
        row.worktree_kind !== undefined &&
        row.worktree_kind !== null &&
        !['main', 'linked'].includes(row.worktree_kind as string)
      )
        fail('Invalid legacy worktree kind');
      return {
        id: id(row.id),
        connectionId,
        source: source as string,
        name: string(row.name),
        path: string(row.path),
        pinned: row.pinned ?? 0,
        createdAt: date(row.created_at),
        worktreeKind: row.worktree_kind ?? null,
      };
    });
    const repoIds = new Set(repositories.map((repo) => repo.id));
    const tokens: Array<{
      id: string;
      name: string;
      nameKey: string;
      version: string;
      updatedAt: string;
      provider: unknown;
      origin: unknown;
      ciphertext: string;
    }> = [];
    const secretRows = new Map(
      snapshot.rows.access_token_secrets.map((row) => {
        keys(row, ['token_id', 'ciphertext']);
        return [id(row.token_id), string(row.ciphertext, 1400000)] as const;
      }),
    );
    const names = new Set<string>();
    for (const row of snapshot.rows.access_tokens) {
      keys(row, ['id', 'name', 'name_key', 'version', 'updated_at', 'provider', 'origin']);
      const tokenId = id(row.id),
        name = string(row.name, 50),
        nameKey = string(row.name_key, 50);
      if (name.trim() !== name || name.toLowerCase() !== nameKey || names.has(nameKey))
        fail('Legacy token names are inconsistent');
      names.add(nameKey);
      const provider = row.provider ?? null,
        origin = row.origin ?? null;
      if (
        provider === null
          ? origin !== null
          : !['github', 'gitlab'].includes(provider as string) || origin === null
      )
        fail('Legacy token scope is invalid');
      if (origin !== null && new URL(web(origin)).origin !== origin)
        fail('Legacy token origin is invalid');
      const original = secretRows.get(tokenId);
      if (!original) fail('Legacy token secret is missing');
      const value = tokenValue(await decrypt(original));
      tokens.push({
        id: tokenId,
        name,
        nameKey,
        version: id(row.version),
        updatedAt: date(row.updated_at),
        provider,
        origin,
        ciphertext: cipher.encrypt(JSON.stringify({ tokenId, value })),
      });
      secretRows.delete(tokenId);
    }
    if (secretRows.size) fail('Legacy token secret has no owner');
    const tokenIds = new Set(tokens.map((token) => token.id));
    const bindings = snapshot.rows.access_token_bindings.map((row) => {
      keys(row, [
        'repository_id',
        'remote',
        'target',
        'provider',
        'token_id',
        'invalid_reason',
        'version',
      ]);
      const repositoryId = id(row.repository_id),
        tokenId = row.token_id === null ? null : id(row.token_id);
      if (
        !repoIds.has(repositoryId) ||
        (tokenId && !tokenIds.has(tokenId)) ||
        !['github', 'gitlab'].includes(row.provider as string) ||
        (row.invalid_reason !== null &&
          !['target-changed', 'token-deleted'].includes(row.invalid_reason as string)) ||
        (row.invalid_reason !== null && tokenId !== null)
      )
        fail('Legacy token binding is invalid');
      const target = web(row.target);
      const token = tokens.find((token) => token.id === tokenId);
      if (token && (token.provider !== row.provider || token.origin !== new URL(target).origin))
        fail('Legacy token binding scope does not match');
      return {
        repositoryId,
        remote: string(row.remote),
        target,
        provider: row.provider,
        tokenId,
        reason: row.invalid_reason,
        version: id(row.version),
      };
    });
    if (snapshot.rows.access_token_state.length > 1) fail('Legacy token revision is invalid');
    const tokenState = snapshot.rows.access_token_state[0];
    if (tokenState) {
      keys(tokenState, ['id', 'revision']);
      if (tokenState.id !== 1) fail();
      id(tokenState.revision);
    }
    if ((tokens.length || bindings.length) && !tokenState) fail('Legacy token revision is missing');
    const documents: Record<string, unknown> = {};
    const legacyAi = snapshot.documents['ai-settings.json'];
    if (legacyAi !== undefined) {
      if (!isRecord(legacyAi) || !Array.isArray(legacyAi.providers))
        fail('Legacy AI configuration is invalid');
      for (const provider of legacyAi.providers)
        if (isRecord(provider) && provider.encryptedKey !== undefined)
          await decrypt(provider.encryptedKey);
      const reader = {
        available: true,
        description: 'Migration validation',
        encrypt() {
          throw Error();
        },
        decrypt(value: string) {
          const result = decrypted.get(value);
          if (result === undefined) throw Error();
          return result;
        },
      };
      const old = new AiSettingsStore(readonlyDocument(legacyAi), reader);
      const publicSettings = old.read();
      documents['ai-settings'] = {
        revision: publicSettings.revision,
        commit: publicSettings.commit,
        providers: publicSettings.providers.map(({ hasApiKey, ...provider }) => ({
          ...provider,
          ...(hasApiKey
            ? {
                encryptedKey: cipher.encrypt(
                  JSON.stringify({ id: provider.id, key: old.key(provider.id) }),
                ),
              }
            : {}),
        })),
      };
    }
    const legacyProxy = snapshot.documents['network-proxy.json'];
    if (legacyProxy !== undefined) {
      if (!isRecord(legacyProxy)) fail('Legacy proxy configuration is invalid');
      const old = new ProxySettingsStore(readonlyDocument(legacyProxy), cipher).read();
      const { hasCredentials, secretStorageAvailable, ...saved } = old;
      let encryptedCredentials: string | undefined;
      if (hasCredentials) {
        let value;
        try {
          value = JSON.parse(await decrypt(legacyProxy.encryptedCredentials));
        } catch {
          fail('Legacy proxy credentials are invalid');
        }
        if (!isRecord(value)) fail();
        const shadow = new ProxySettingsStore(
          readonlyDocument({
            ...legacyProxy,
            enabled: true,
            authEnabled: true,
            host: value.host,
            port: value.port,
            protocol: value.protocol,
          }),
          {
            available: true,
            description: 'Migration validation',
            encrypt() {
              throw Error();
            },
            decrypt() {
              return JSON.stringify(value);
            },
          },
        );
        const checked = shadow.snapshot();
        if (!checked.credentials) fail();
        encryptedCredentials = cipher.encrypt(
          JSON.stringify({
            ...checked.credentials,
            host: checked.host,
            port: checked.port,
            protocol: checked.protocol,
          }),
        );
      }
      documents['network-proxy'] = {
        ...saved,
        ...(encryptedCredentials ? { encryptedCredentials } : {}),
      };
    }
    const logging = snapshot.documents['logging.json'];
    if (logging !== undefined)
      documents['logging-settings'] = {
        revision: randomUUID(),
        settings: validateLoggingSettings(logging),
      };
    let unresolvedReferences = 0;
    const workspace = snapshot.documents['workspace.json'];
    if (workspace !== undefined) {
      if (!isRecord(workspace) || workspace.version !== 1 || !isRecord(workspace.state))
        fail('Legacy workspace is invalid');
      const allowed = [
        'repositorySession',
        'collapsedConnectionIds',
        'connectionOrder',
        'repositoryOrderByConnection',
        'layout',
        'appearance',
        'codeAppearance',
        'collectionViews',
      ];
      keys(workspace.state, allowed);
      const preferences = workspace.state;
      const refs = (value: unknown, ids: Set<string>) => {
        if (value === undefined) return;
        if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
          fail('Legacy workspace references are invalid');
        unresolvedReferences += value.filter((item) => !ids.has(item)).length;
      };
      refs(preferences.connectionOrder, hostIds);
      refs(preferences.collapsedConnectionIds, new Set([...hostIds, '@local']));
      if (preferences.repositorySession !== undefined) {
        if (!isRecord(preferences.repositorySession)) fail();
        refs(preferences.repositorySession.ids, repoIds);
        if (
          preferences.repositorySession.activeId !== null &&
          preferences.repositorySession.activeId !== undefined &&
          !repoIds.has(String(preferences.repositorySession.activeId))
        )
          unresolvedReferences++;
      }
      if (preferences.repositoryOrderByConnection !== undefined) {
        if (!isRecord(preferences.repositoryOrderByConnection)) fail();
        for (const [host, ids] of Object.entries(preferences.repositoryOrderByConnection)) {
          if (host !== '@local' && !hostIds.has(host)) unresolvedReferences++;
          refs(ids, repoIds);
        }
      }
      documents['workspace-preferences'] = workspace;
    }
    return {
      hosts,
      repositories,
      tokens,
      bindings,
      documents,
      tokenRevision: tokenState ? id(tokenState.revision) : randomUUID(),
      unresolvedReferences,
    };
  } finally {
    decrypted.clear();
    source.close?.();
  }
}

export async function importLegacyState(
  state: AgentState,
  sourceDirectory: string,
  options: LegacyImportOptions = {},
): Promise<LegacyImportReceipt> {
  const snapshot = await captureLegacySource(sourceDirectory, state.root, options.signal);
  const previous = state.database
    .prepare('SELECT fingerprint, summary FROM imports WHERE id = ?')
    .get(snapshot.id) as { fingerprint: string; summary: string } | undefined;
  if (previous) {
    if (previous.fingerprint !== snapshot.fingerprint)
      throw new StateFault(
        'conflict',
        'This legacy source was already imported and has since changed; no state was overwritten',
      );
    return { ...JSON.parse(previous.summary), alreadyImported: true };
  }
  const populated = state.database
    .prepare(
      `SELECT 1 FROM connections UNION ALL SELECT 1 FROM repositories UNION ALL SELECT 1 FROM access_tokens UNION ALL SELECT 1 FROM documents WHERE name != 'credential-key' LIMIT 1`,
    )
    .get();
  if (populated)
    throw new StateFault(
      'conflict',
      'Legacy import requires an empty Agent business state; existing configuration was retained',
    );
  const stateBackup = await state.backup(options.signal);
  const ai = snapshot.documents['ai-settings.json'],
    proxy = snapshot.documents['network-proxy.json'];
  const hasSecrets =
    snapshot.rows.access_token_secrets.length ||
    snapshot.rows.connections.some((row) => row.password || row.passphrase) ||
    (isRecord(ai) &&
      Array.isArray(ai.providers) &&
      ai.providers.some((p) => isRecord(p) && p.encryptedKey)) ||
    (isRecord(proxy) && proxy.encryptedCredentials);
  const unavailable = () => {
    throw new StateFault('unavailable', 'Credential store not initialized');
  };
  const cipher = hasSecrets
    ? await openProtectedSecrets(state.root, state.agentId, state.document('credential-key'), {
        ...options.secretOptions,
        allowInitialize: !state.hasCredentialMaterial(),
        signal: options.signal,
      })
    : {
        available: false,
        description: 'No legacy credentials',
        encrypt: unavailable,
        decrypt: unavailable,
        close() {},
      };
  try {
    const data = await convert(snapshot, cipher, options);
    await verifyLegacySource(snapshot, options.signal);
    options.signal?.throwIfAborted();
    const receipt: LegacyImportReceipt = {
      importId: snapshot.id,
      fingerprint: snapshot.fingerprint,
      sourceBackupId: snapshot.backupId,
      stateBackupId: stateBackup.split(/[\\/]/).at(-1)!,
      alreadyImported: false,
      counts: {
        hosts: data.hosts.length,
        repositories: data.repositories.length,
        tokens: data.tokens.length,
        bindings: data.bindings.length,
        documents: Object.keys(data.documents).length,
        unresolvedReferences: data.unresolvedReferences,
      },
    };
    state.database
      .transaction(() => {
        for (const host of data.hosts)
          state.database
            .prepare('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            .run(
              host.id,
              host.profile.name,
              host.profile.host,
              host.profile.port,
              host.profile.username,
              host.profile.authType,
              host.profile.privateKeyPath,
              host.password,
              host.passphrase,
              host.createdAt,
              host.updatedAt,
            );
        state.database
          .prepare(
            'INSERT INTO agent_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          )
          .run('hostProfilesRevision', randomUUID());
        for (const repo of data.repositories)
          state.database
            .prepare('INSERT INTO repositories VALUES (?,?,?,?,?,?,?,?)')
            .run(
              repo.id,
              repo.connectionId,
              repo.source,
              repo.name,
              repo.path,
              repo.pinned,
              repo.createdAt,
              repo.worktreeKind,
            );
        for (const [kind, items] of [
          ['host-profile', data.hosts],
          ['repository', data.repositories],
        ] as const)
          for (const item of items)
            state.database
              .prepare('INSERT INTO resource_ids VALUES (?,?,?)')
              .run(item.id, kind, item.id);
        state.database
          .prepare(
            'INSERT INTO access_token_state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision',
          )
          .run(data.tokenRevision);
        for (const token of data.tokens) {
          state.database
            .prepare('INSERT INTO access_tokens VALUES (?,?,?,?,?,?,?)')
            .run(
              token.id,
              token.name,
              token.nameKey,
              token.version,
              token.updatedAt,
              token.provider,
              token.origin,
            );
          state.database
            .prepare('INSERT INTO access_token_secrets VALUES (?,?)')
            .run(token.id, token.ciphertext);
        }
        for (const binding of data.bindings)
          state.database
            .prepare('INSERT INTO access_token_bindings VALUES (?,?,?,?,?,?,?)')
            .run(
              binding.repositoryId,
              binding.remote,
              binding.target,
              binding.provider,
              binding.tokenId,
              binding.reason,
              binding.version,
            );
        for (const [name, value] of Object.entries(data.documents)) {
          const document = state.document(name);
          document.read();
          document.write(value);
        }
        state.database
          .prepare('INSERT INTO imports VALUES (?,?,?,?,?)')
          .run(
            snapshot.id,
            snapshot.fingerprint,
            'legacy-unversioned',
            new Date().toISOString(),
            JSON.stringify(receipt),
          );
      })
      .immediate();
    return receipt;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof StateFault) throw error;
    throw new StateFault(
      'corrupt',
      'Legacy import failed; original source and pre-import state backup were retained',
    );
  } finally {
    cipher.close();
  }
}
