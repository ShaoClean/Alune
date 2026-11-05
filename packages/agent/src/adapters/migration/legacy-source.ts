import Database from 'better-sqlite3';
import { copyFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  assertRegularFile,
  atomicPrivateJson,
  privateDirectory,
  protectPrivatePaths,
  statePathExists,
  verifyPrivateSourceKey,
} from '../private-files';
import { hashFile } from '../sqlite/state';
import { StateFault } from '../../ports/state';
import { nativeFiles } from '../files/native';

export const LEGACY_JSON_FILES = [
  'ai-settings.json',
  'network-proxy.json',
  'logging.json',
  'workspace.json',
] as const;
export const LEGACY_TABLES = [
  'connections',
  'repositories',
  'access_token_state',
  'access_tokens',
  'access_token_secrets',
  'access_token_bindings',
] as const;
export type LegacyRows = Record<(typeof LEGACY_TABLES)[number], Record<string, unknown>[]>;
const legacyColumns: Record<(typeof LEGACY_TABLES)[number], readonly string[]> = {
  connections: [
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
  ],
  repositories: [
    'id',
    'connection_id',
    'source',
    'name',
    'path',
    'pinned',
    'created_at',
    'worktree_kind',
  ],
  access_token_state: ['id', 'revision'],
  access_tokens: ['id', 'name', 'name_key', 'version', 'updated_at', 'provider', 'origin'],
  access_token_secrets: ['token_id', 'ciphertext'],
  access_token_bindings: [
    'repository_id',
    'remote',
    'target',
    'provider',
    'token_id',
    'invalid_reason',
    'version',
  ],
};
function checkLegacyVersion(db: Database.Database): void {
  // The supported standalone/Electron schema has no application/version header.
  if (
    db.pragma('user_version', { simple: true }) !== 0 ||
    db.pragma('application_id', { simple: true }) !== 0
  )
    throw new StateFault('corrupt', 'Unsupported legacy database version; source was retained');
}
export interface LegacySnapshot {
  id: string;
  source: string;
  backupId: string;
  directory: string;
  fingerprint: string;
  sourceFiles: Record<string, string>;
  rows: LegacyRows;
  documents: Partial<Record<(typeof LEGACY_JSON_FILES)[number], unknown>>;
}

async function sourceHashes(source: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const name of ['alune.db', 'alune.db-wal', 'ai-master-key', ...LEGACY_JSON_FILES]) {
    const file = join(source, name);
    if (!statePathExists(file)) continue;
    assertRegularFile(file);
    if (name === 'ai-master-key') await verifyPrivateSourceKey(file, signal);
    hashes[name] = await hashFile(file, signal);
  }
  return hashes;
}
function readRows(file: string): LegacyRows {
  const rows = Object.fromEntries(LEGACY_TABLES.map((name) => [name, []])) as unknown as LegacyRows;
  if (!statePathExists(file)) return rows;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('trusted_schema = OFF');
    checkLegacyVersion(db);
    if (db.pragma('quick_check', { simple: true }) !== 'ok')
      throw new StateFault('corrupt', 'Legacy database integrity check failed');
    const objects = db
      .prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as { type: string; name: string }[];
    if (
      objects.some(
        (item) =>
          item.type === 'trigger' ||
          item.type === 'view' ||
          (item.type === 'table' && !LEGACY_TABLES.includes(item.name as any)),
      )
    )
      throw new StateFault(
        'corrupt',
        'Legacy database contains an unsupported schema; source was retained',
      );
    for (const name of LEGACY_TABLES) {
      if (!objects.some((item) => item.type === 'table' && item.name === name)) continue;
      const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
      if (columns.some((column) => !legacyColumns[name].includes(column.name)))
        throw new StateFault(
          'corrupt',
          'Legacy table has unsupported columns; source was retained',
        );
      // Table identifiers are fixed constants, never source-provided SQL.
      rows[name] = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() as Record<
        string,
        unknown
      >[];
    }
    if ((db.pragma('foreign_key_check') as unknown[]).length)
      throw new StateFault('corrupt', 'Legacy database references are inconsistent');
    return rows;
  } finally {
    db.close();
  }
}

/** Read-only source capture. Every failed attempt retains its private evidence directory. */
export async function captureLegacySource(
  sourceDirectory: string,
  targetDirectory: string,
  signal?: AbortSignal,
): Promise<LegacySnapshot> {
  signal?.throwIfAborted();
  const sourceInfo = lstatSync(sourceDirectory);
  if (
    !sourceInfo.isDirectory() ||
    sourceInfo.isSymbolicLink() ||
    (process.getuid && sourceInfo.uid !== process.getuid())
  )
    throw new StateFault('permission', 'Legacy source must be a directory owned by this user');
  const source = realpathSync.native(sourceDirectory);
  if (source === realpathSync.native(targetDirectory))
    throw new StateFault('conflict', 'Legacy and Agent state must use separate directories');
  const before = await sourceHashes(source, signal);
  if (
    !Object.keys(before).some(
      (name) => name === 'alune.db' || LEGACY_JSON_FILES.includes(name as any),
    )
  )
    throw new StateFault('not-found', 'No supported legacy state was found');
  const backupId = randomUUID();
  const root = await privateDirectory(join(targetDirectory, 'migration-sources'), signal);
  const directory = await privateDirectory(join(root, backupId), signal);
  const sourceDatabase = join(source, 'alune.db');
  try {
    if (statePathExists(sourceDatabase)) {
      for (const suffix of ['', '-wal', '-shm']) assertRegularFile(sourceDatabase + suffix);
      const db = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
      try {
        db.pragma('trusted_schema = OFF');
        checkLegacyVersion(db);
        if (db.pragma('quick_check', { simple: true }) !== 'ok')
          throw new StateFault('corrupt', 'Legacy database integrity check failed');
        await db.backup(join(directory, 'alune.db'), {
          progress() {
            signal?.throwIfAborted();
            return 100;
          },
        });
      } finally {
        db.close();
      }
    }
    const documents: LegacySnapshot['documents'] = {};
    for (const name of LEGACY_JSON_FILES) {
      const file = join(source, name);
      if (!statePathExists(file)) continue;
      if (lstatSync(file).size > 64 * 1024 * 1024)
        throw new StateFault('corrupt', 'Legacy configuration exceeds the supported import size');
      copyFileSync(file, join(directory, name));
    }
    const after = await sourceHashes(source, signal);
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new StateFault(
        'conflict',
        'Legacy source changed during capture; stop its writer before importing',
      );
    const names = ['alune.db', ...LEGACY_JSON_FILES].filter((name) =>
      statePathExists(join(directory, name)),
    );
    await protectPrivatePaths(
      names.map((name) => join(directory, name)),
      signal,
    );
    const hashes: Record<string, string> = {};
    for (const name of names) hashes[name] = await hashFile(join(directory, name), signal);
    // Keep the source fingerprints, not the source key. Its original bytes and
    // permissions remain untouched; safeStorage never gets copied as a key file.
    atomicPrivateJson(join(directory, 'manifest.json'), {
      version: 1,
      kind: 'legacy-source-snapshot',
      sourceFiles: before,
      files: hashes,
    });
    const rows = readRows(join(directory, 'alune.db'));
    for (const name of LEGACY_JSON_FILES) {
      if (!statePathExists(join(directory, name))) continue;
      try {
        documents[name] = JSON.parse(
          (
            await nativeFiles.read(join(directory, name), { maxBytes: 64 * 1024 * 1024, signal })
          ).toString('utf8'),
        );
      } catch {
        throw new StateFault(
          'corrupt',
          'Legacy JSON configuration is damaged; private source backup retained',
        );
      }
    }
    // Logical database content avoids backup-header differences on a repeat run.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ rows, documents, key: before['ai-master-key'] ?? null }))
      .digest('hex');
    const id = createHash('sha256').update(resolve(source)).digest('hex');
    return { id, source, backupId, directory, fingerprint, rows, documents, sourceFiles: before };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof StateFault) throw error;
    throw new StateFault(
      'corrupt',
      'Legacy state could not be captured; original source and private backup were retained',
    );
  }
}
export async function verifyLegacySource(
  snapshot: LegacySnapshot,
  signal?: AbortSignal,
): Promise<void> {
  if (
    JSON.stringify(await sourceHashes(snapshot.source, signal)) !==
    JSON.stringify(snapshot.sourceFiles)
  )
    throw new StateFault(
      'conflict',
      'Legacy source changed after capture; stop its writer before importing',
    );
}

// Return only hashes of the legacy credential fields to the native decryptor.
// A compromised importer cannot select new ciphertexts for Electron to decrypt.
export async function legacyCiphertextHashes(source: string) {
  const info = lstatSync(source);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new StateFault('permission', 'Invalid legacy source');
  const file = join(source, 'alune.db');
  for (const suffix of ['', '-wal', '-shm']) assertRegularFile(file + suffix);
  const hashes = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('safe-storage:'))
      hashes.add(createHash('sha256').update(value).digest('hex'));
  };
  for (const row of readRows(file).access_token_secrets) add(row.ciphertext);
  for (const name of ['ai-settings.json', 'network-proxy.json']) {
    const path = join(source, name);
    if (!statePathExists(path)) continue;
    assertRegularFile(path);
    const doc = JSON.parse(
      (await nativeFiles.read(path, { maxBytes: 64 * 1024 * 1024 })).toString('utf8'),
    );
    if (name === 'ai-settings.json') for (const p of doc.providers) add(p.encryptedKey);
    else add(doc.encryptedCredentials);
  }
  return [...hashes];
}
