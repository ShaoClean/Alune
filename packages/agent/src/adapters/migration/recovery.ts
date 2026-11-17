import Database from 'better-sqlite3';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  writeSync,
  readSync,
  openSync,
  closeSync,
  fsyncSync,
  statSync,
  linkSync,
  rmSync,
  copyFileSync,
  mkdtempSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AgentState, hashFile, type StateBackup } from '../sqlite/state';
import {
  assertRegularFile,
  atomicPrivateJson,
  privateDirectory,
  protectPrivatePaths,
  stateDirectory,
  statePathExists,
} from '../private-files';
import {
  cipherFromRecoveryMaterial,
  openProtectedSecrets,
  readRecoveryMaterial,
  type ProtectedSecretOptions,
  type ProtectedSecrets,
} from '../secrets/protected';
import { StateFault, type SecretCipher } from '../../ports/state';
import { isRecord } from '@alune/protocol';

const MAGIC = Buffer.from('ALUNE-RECOVERY-1\n');
const HEADER_BYTES = MAGIC.length + 16 + 12;
const MAX_METADATA = 65536;
interface RecoveryMetadata {
  version: 1;
  agentId: string;
  manifest: StateBackup;
  databaseBytes: number;
  key: { keyId: string; masterKey: string } | null;
}
function invalid(): never {
  throw new StateFault(
    'corrupt',
    'Recovery file or passphrase is invalid; existing state was retained',
  );
}
async function derive(passphrase: Buffer, salt: Buffer, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if (passphrase.length < 12 || passphrase.length > 1024)
    throw new StateFault('invalid-input', 'Recovery passphrase must contain 12–1024 UTF-8 bytes');
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      passphrase,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
  if (signal?.aborted) {
    key.fill(0);
    signal.throwIfAborted();
  }
  return key;
}
function countCredentials(db: Database.Database): number {
  return (
    db
      .prepare(
        `SELECT
    (SELECT count(*) FROM connections WHERE password_secret IS NOT NULL) +
    (SELECT count(*) FROM connections WHERE passphrase_secret IS NOT NULL) +
    (SELECT count(*) FROM access_token_secrets) +
    (SELECT count(*) FROM documents,json_tree(documents.body) AS item WHERE item.key IN ('encryptedKey','encryptedCredentials') AND item.type != 'null') AS count`,
      )
      .get() as { count: number }
  ).count;
}
function descriptorDocument(db: Database.Database) {
  return {
    read() {
      const row = db.prepare("SELECT body FROM documents WHERE name = 'credential-key'").get() as
        | { body: string }
        | undefined;
      return row ? JSON.parse(row.body) : undefined;
    },
    write() {
      throw Error('Read-only backup document');
    },
  };
}
function flushFile(file: string) {
  const fd = openSync(file, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function flushDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const fd = openSync(directory, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The caller holds AgentState's writer lease. Only an encrypted envelope is exported. */
export async function createRecoveryBackup(
  state: AgentState,
  outputFile: string,
  passphrase: Buffer,
  signal?: AbortSignal,
  secretOptions: Pick<ProtectedSecretOptions, 'keychain'> = {},
) {
  const output = resolve(outputFile);
  signal?.throwIfAborted();
  if (statePathExists(output))
    throw new StateFault('conflict', 'Recovery output already exists; no file was overwritten');
  stateDirectory(dirname(output));
  const snapshot = await state.backup(signal);
  const file = join(snapshot, 'state.sqlite');
  const manifest = JSON.parse(readFileSync(join(snapshot, 'manifest.json'), 'utf8')) as StateBackup;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  let material: Awaited<ReturnType<typeof readRecoveryMaterial>> | undefined;
  try {
    const document = descriptorDocument(db);
    if (document.read() !== undefined) {
      try {
        material = await readRecoveryMaterial(
          state.root,
          state.agentId,
          document,
          signal,
          secretOptions,
        );
      } catch (error) {
        if (countCredentials(db)) throw error;
        signal?.throwIfAborted();
      }
    } else if (countCredentials(db))
      throw new StateFault(
        'corrupt',
        'Credential descriptor is missing; a complete recovery backup cannot be made',
      );
  } finally {
    db.close();
  }
  const metadata: RecoveryMetadata = {
    version: 1,
    agentId: state.agentId,
    manifest,
    databaseBytes: statSync(file).size,
    key: material ? { keyId: material.keyId, masterKey: material.key.toString('base64') } : null,
  };
  const encoded = Buffer.from(JSON.stringify(metadata));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(encoded.length);
  const salt = randomBytes(16),
    iv = randomBytes(12),
    header = Buffer.concat([MAGIC, salt, iv]);
  const temporary = join(dirname(output), `.${randomUUID()}.recovery.tmp`);
  let key: Buffer | undefined, fd: number | undefined;
  try {
    key = await derive(passphrase, salt, signal);
    fd = openSync(temporary, 'wx', 0o600);
    await protectPrivatePaths([temporary], signal);
    writeSync(fd, header);
    closeSync(fd);
    fd = undefined;
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(header);
    const source = Readable.from(
      (async function* () {
        yield length;
        yield encoded;
        for await (const chunk of createReadStream(file, { signal })) yield chunk;
      })(),
    );
    await pipeline(
      source,
      cipher,
      createWriteStream(temporary, { flags: 'r+', start: header.length }),
      { signal },
    );
    fd = openSync(temporary, 'a');
    writeSync(fd, cipher.getAuthTag());
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    signal?.throwIfAborted();
    linkSync(temporary, output);
    rmSync(temporary);
    flushDirectory(dirname(output));
    return {
      agentId: state.agentId,
      scope: 'identity-state-and-credentials' as const,
      sha256: await hashFile(output),
      bytes: statSync(output).size,
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
    key?.fill(0);
    material?.key.fill(0);
    encoded.fill(0);
    metadata.key = null;
    rmSync(temporary, { force: true });
  }
}

async function decryptEnvelope(
  input: string,
  stage: string,
  passphrase: Buffer,
  signal?: AbortSignal,
): Promise<RecoveryMetadata> {
  assertRegularFile(input);
  const info = statSync(input);
  if (info.size < HEADER_BYTES + 16 + 4) invalid();
  const fd = openSync(input, 'r'),
    header = Buffer.alloc(HEADER_BYTES),
    tag = Buffer.alloc(16);
  try {
    if (
      readSync(fd, header, 0, header.length, 0) !== header.length ||
      readSync(fd, tag, 0, 16, info.size - 16) !== 16
    )
      invalid();
  } finally {
    closeSync(fd);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) invalid();
  const key = await derive(passphrase, header.subarray(MAGIC.length, MAGIC.length + 16), signal);
  const prefix = Buffer.alloc(4);
  let prefixBytes = 0,
    metadata: Buffer | undefined,
    metadataBytes = 0;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length + 16));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const strip = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        try {
          let offset = 0;
          if (prefixBytes < 4) {
            const bytes = Math.min(4 - prefixBytes, chunk.length);
            chunk.copy(prefix, prefixBytes, 0, bytes);
            prefixBytes += bytes;
            offset += bytes;
            if (prefixBytes === 4) {
              const bytes = prefix.readUInt32BE();
              if (bytes < 1 || bytes > MAX_METADATA) invalid();
              metadata = Buffer.alloc(bytes);
            }
          }
          if (metadata && metadataBytes < metadata.length) {
            const bytes = Math.min(metadata.length - metadataBytes, chunk.length - offset);
            chunk.copy(metadata, metadataBytes, offset, offset + bytes);
            metadataBytes += bytes;
            offset += bytes;
          }
          callback(null, chunk.subarray(offset));
        } catch (error) {
          callback(error as Error);
        }
      },
    });
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: info.size - 17, signal }),
      decipher,
      strip,
      createWriteStream(join(stage, 'state.sqlite'), { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    if (!metadata || metadataBytes !== metadata.length) invalid();
    const value = JSON.parse(metadata.toString('utf8')) as RecoveryMetadata;
    if (
      value.version !== 1 ||
      !isRecord(value.manifest) ||
      value.manifest.agentId !== value.agentId ||
      value.manifest.version !== 1 ||
      value.manifest.kind !== 'agent-state-database' ||
      !Number.isSafeInteger(value.databaseBytes) ||
      value.databaseBytes !== statSync(join(stage, 'state.sqlite')).size ||
      typeof value.manifest.sha256 !== 'string' ||
      (await hashFile(join(stage, 'state.sqlite'), signal)) !== value.manifest.sha256
    )
      invalid();
    if (
      AgentState.validateBackupDatabase(join(stage, 'state.sqlite'), value.agentId) !==
      value.manifest.schemaVersion
    )
      invalid();
    return value;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof StateFault && error.kind === 'invalid-input') throw error;
    return invalid();
  } finally {
    key.fill(0);
    metadata?.fill(0);
  }
}
function rewrap(db: Database.Database, source: SecretCipher, destination: SecretCipher) {
  let count = 0;
  for (const row of db
    .prepare('SELECT id,password_secret,passphrase_secret FROM connections')
    .all() as { id: string; password_secret: string | null; passphrase_secret: string | null }[]) {
    for (const field of ['password_secret', 'passphrase_secret'] as const)
      if (row[field] !== null) {
        const value = destination.encrypt(source.decrypt(row[field]!));
        db.prepare(`UPDATE connections SET ${field} = ? WHERE id = ?`).run(value, row.id);
        count++;
      }
  }
  for (const row of db.prepare('SELECT token_id,ciphertext FROM access_token_secrets').all() as {
    token_id: string;
    ciphertext: string;
  }[]) {
    db.prepare('UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?').run(
      destination.encrypt(source.decrypt(row.ciphertext)),
      row.token_id,
    );
    count++;
  }
  for (const name of ['ai-settings', 'network-proxy']) {
    const row = db.prepare('SELECT body FROM documents WHERE name = ?').get(name) as
      | { body: string }
      | undefined;
    if (!row) continue;
    const value = JSON.parse(row.body);
    let changed = false;
    const convert = (item: Record<string, unknown>, field: string) => {
      if (item[field] !== undefined && item[field] !== null) {
        if (typeof item[field] !== 'string') invalid();
        item[field] = destination.encrypt(source.decrypt(item[field] as string));
        count++;
        changed = true;
      }
    };
    if (isRecord(value)) {
      if (name === 'ai-settings' && Array.isArray(value.providers))
        for (const provider of value.providers)
          if (isRecord(provider)) convert(provider, 'encryptedKey');
      if (name === 'network-proxy') convert(value, 'encryptedCredentials');
    }
    if (changed)
      db.prepare('UPDATE documents SET body = ? WHERE name = ?').run(JSON.stringify(value), name);
  }
  return count;
}

export async function restoreRecoveryBackup(
  directory: string,
  inputFile: string,
  passphrase: Buffer,
  options: {
    signal?: AbortSignal;
    secretOptions?: Pick<ProtectedSecretOptions, 'backend' | 'keychain'>;
  } = {},
) {
  options.signal?.throwIfAborted();
  const stage = mkdtempSync(join(tmpdir(), 'alune-recovery-'));
  let metadata: RecoveryMetadata | undefined;
  let source: ProtectedSecrets | undefined;
  let destination: ProtectedSecrets | undefined;
  try {
    await privateDirectory(stage, options.signal);
    metadata = await decryptEnvelope(resolve(inputFile), stage, passphrase, options.signal);
    const expected = metadata;
    const dbFile = join(stage, 'state.sqlite');
    const result = await AgentState.restore(directory, metadata.agentId, stage, options.signal, {
      async prepare(root) {
        const identity = join(root, 'identity.json');
        assertRegularFile(identity);
        if (statePathExists(identity)) {
          try {
            const current = JSON.parse(readFileSync(identity, 'utf8'));
            if (typeof current?.agentId === 'string' && current.agentId !== expected.agentId)
              throw new StateFault(
                'conflict',
                'Recovery belongs to another Agent; choose a separate destination',
              );
          } catch (error) {
            if (error instanceof StateFault)
              throw error; /* Damaged bytes are retained before publication. */
          }
        }
        const db = new Database(dbFile);
        db.pragma('trusted_schema = OFF');
        db.pragma('foreign_keys = ON');
        try {
          const descriptor = descriptorDocument(db).read();
          const count = countCredentials(db);
          if (expected.key !== null) {
            if (
              !isRecord(expected.key) ||
              typeof expected.key.masterKey !== 'string' ||
              typeof expected.key.keyId !== 'string' ||
              !isRecord(descriptor)
            )
              invalid();
            const key = Buffer.from(expected.key.masterKey, 'base64');
            if (
              key.length !== 32 ||
              key.toString('base64') !== expected.key.masterKey ||
              descriptor.keyId !== expected.key.keyId ||
              descriptor.agentId !== expected.agentId ||
              descriptor.fingerprint !== createHash('sha256').update(key).digest('hex')
            ) {
              key.fill(0);
              invalid();
            }
            source = cipherFromRecoveryMaterial(key, expected.agentId, expected.key.keyId);
          } else if (count) invalid();
          let restoredDescriptor: unknown;
          if (descriptor !== undefined || count) {
            const recovery = await privateDirectory(join(root, 'recovery'), options.signal);
            const journal = join(recovery, `${randomUUID()}.key-initialization.json`);
            destination = await openProtectedSecrets(
              root,
              expected.agentId,
              {
                read: () => restoredDescriptor,
                write(value) {
                  atomicPrivateJson(journal, value);
                  restoredDescriptor = value;
                },
              },
              { ...options.secretOptions, allowInitialize: true, signal: options.signal },
            );
          }
          db.transaction(() => {
            if (count && (!source || !destination || rewrap(db, source, destination) !== count))
              invalid();
            db.prepare("DELETE FROM documents WHERE name = 'credential-key'").run();
            if (restoredDescriptor !== undefined)
              db.prepare('INSERT INTO documents VALUES (?,?,?,?)').run(
                'credential-key',
                randomUUID(),
                JSON.stringify(restoredDescriptor),
                new Date().toISOString(),
              );
          }).immediate();
          db.pragma('wal_checkpoint(TRUNCATE)');
        } finally {
          db.close();
          source?.close();
          source = undefined;
          destination?.close();
          destination = undefined;
        }
        flushFile(dbFile);
        atomicPrivateJson(join(stage, 'manifest.json'), {
          ...expected.manifest,
          sha256: await hashFile(dbFile, options.signal),
        });
      },
      async beforePublish(root) {
        const identity = join(root, 'identity.json');
        assertRegularFile(identity);
        const recovery = await privateDirectory(join(root, 'recovery'), options.signal);
        if (statePathExists(identity)) {
          const retained = join(recovery, `${randomUUID()}.identity.json`);
          copyFileSync(identity, retained);
          await protectPrivatePaths([retained], options.signal);
        }
        atomicPrivateJson(identity, { agentId: expected.agentId });
      },
    });
    return {
      agentId: metadata.agentId,
      scope: 'identity-state-and-credentials' as const,
      ...result,
    };
  } finally {
    source?.close();
    destination?.close();
    if (metadata) metadata.key = null;
    rmSync(stage, { recursive: true, force: true });
  }
}
