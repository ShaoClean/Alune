import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  readFileSync,
  readdirSync,
  rmSync,
  copyFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertRegularFile,
  atomicPrivateJson,
  privateDirectory,
  protectPrivatePaths,
  stateDirectory,
  statePathExists as existsSync,
} from '../private-files';
import { StateFault } from '../../ports/state';
import type { JsonDocument } from '../../ports/state';
import type { StorageStatus } from '@alune/protocol';

const APPLICATION_ID = 0x414c554e;
const SCHEMA_VERSION = 1;
const SCHEMA = `
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE agent_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (name TEXT PRIMARY KEY, revision TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), updated_at TEXT NOT NULL);
CREATE TABLE resource_ids (id TEXT PRIMARY KEY, kind TEXT NOT NULL, local_key TEXT NOT NULL, UNIQUE(kind, local_key));
CREATE TABLE imports (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, source_version TEXT NOT NULL, completed_at TEXT NOT NULL, summary TEXT NOT NULL CHECK(json_valid(summary)));
CREATE TABLE operations (id TEXT PRIMARY KEY, method TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','completed','unknown')), result TEXT CHECK(result IS NULL OR json_valid(result)), started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, auth_type TEXT NOT NULL, private_key_path TEXT, password_secret TEXT, passphrase_secret TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE repositories (id TEXT PRIMARY KEY, connection_id TEXT REFERENCES connections(id), source TEXT NOT NULL CHECK(source IN ('local','ssh')), name TEXT NOT NULL, path TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, worktree_kind TEXT);
CREATE TABLE access_token_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL);
CREATE TABLE access_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, version TEXT NOT NULL, updated_at TEXT NOT NULL, provider TEXT, origin TEXT);
CREATE TABLE access_token_secrets (token_id TEXT PRIMARY KEY REFERENCES access_tokens(id) ON DELETE CASCADE, ciphertext TEXT NOT NULL);
CREATE TABLE access_token_bindings (repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, remote TEXT NOT NULL, target TEXT NOT NULL, provider TEXT NOT NULL, token_id TEXT REFERENCES access_tokens(id) ON DELETE SET NULL, invalid_reason TEXT, version TEXT NOT NULL, PRIMARY KEY(repository_id, remote));
`;
const schemaChecksum = createHash('sha256').update(SCHEMA).digest('hex');
const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const expectedTables = new Map(
  SCHEMA.split(';')
    .map((sql) => sql.trim())
    .filter(Boolean)
    .map((sql) => [sql.match(/^CREATE TABLE (\w+)/)![1], normalizeSql(sql)]),
);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const json = (value: unknown) => {
  const encoded = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item))
      throw new StateFault('corrupt', 'Non-finite state value');
    return item;
  });
  if (encoded === undefined) throw new StateFault('corrupt', 'State value must be JSON');
  return encoded;
};
export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) digest.update(chunk);
  return digest.digest('hex');
}

/** A separate SQLite write transaction is the process lease. OS locks release on crash. */
class WriterLease {
  private db!: Database.Database;
  constructor(root: string) {
    const file = join(root, 'writer.sqlite');
    assertRegularFile(file);
    try {
      this.db = new Database(file, { timeout: 0 });
      this.db.exec('CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY)');
      this.db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      this.db!?.close();
      const code = (error as { code?: string }).code ?? '';
      if (code.startsWith('SQLITE_BUSY'))
        throw new StateFault('busy', 'Agent data directory already has a writer');
      throw new StateFault(
        /SQLITE_(CORRUPT|NOTADB)/.test(code) ? 'corrupt' : 'unavailable',
        'Agent writer storage cannot be opened; check runtime/permissions or restore valid state. Existing files were retained',
      );
    }
  }
  close() {
    if (this.db.open) {
      try {
        this.db.exec('ROLLBACK');
      } finally {
        this.db.close();
      }
    }
  }
}

function checkDatabase(db: Database.Database, agentId: string): void {
  if (
    db.pragma('quick_check', { simple: true }) !== 'ok' ||
    db.pragma('application_id', { simple: true }) !== APPLICATION_ID ||
    db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION
  )
    throw new StateFault('corrupt', 'Unknown, damaged or unsupported Agent state database');
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string; sql: string }[];
  if (
    tables.length !== expectedTables.size ||
    tables.some((row) => expectedTables.get(row.name) !== normalizeSql(row.sql)) ||
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()
      .length
  )
    throw new StateFault('corrupt', 'Agent database structure does not match its schema version');
  const record = db
    .prepare('SELECT checksum FROM schema_migrations WHERE version = ?')
    .get(SCHEMA_VERSION) as { checksum: string } | undefined;
  const identity = db.prepare("SELECT value FROM agent_meta WHERE key = 'agentId'").get() as
    | { value: string }
    | undefined;
  if (
    record?.checksum !== schemaChecksum ||
    identity?.value !== agentId ||
    (db.pragma('foreign_key_check') as unknown[]).length ||
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger', 'view')").all().length
  )
    throw new StateFault('corrupt', 'Agent schema or identity validation failed');
}
function createDatabase(file: string, agentId: string, initialize: boolean): Database.Database {
  assertRegularFile(file);
  const db = new Database(file);
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    if (initialize && !tables.length && db.pragma('user_version', { simple: true }) === 0) {
      db.transaction(() => {
        db.exec(SCHEMA);
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(
          SCHEMA_VERSION,
          schemaChecksum,
          new Date().toISOString(),
        );
        db.prepare('INSERT INTO agent_meta VALUES (?, ?)').run('agentId', agentId);
        db.pragma(`application_id = ${APPLICATION_ID}`);
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
      }).immediate();
    }
    checkDatabase(db, agentId);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function pointer(file: string, agentId: string): string {
  assertRegularFile(file);
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (uuid(value?.agentId) && value.agentId !== agentId)
      throw new StateFault('conflict', 'State belongs to another Agent');
    if (value?.version !== 1 || value.agentId !== agentId || !uuid(value.generation))
      throw new Error();
    return value.generation;
  } catch (error) {
    if (error instanceof StateFault) throw error;
    throw new StateFault(
      'corrupt',
      'Invalid Agent state pointer; refusing to create empty replacement state',
    );
  }
}

export interface StateBackup {
  version: 1;
  kind: 'agent-state-database';
  agentId: string;
  sourceGeneration: string;
  createdAt: string;
  sha256: string;
  schemaVersion: number;
}
export class AgentState {
  readonly root: string;
  readonly generation: string;
  readonly database!: Database.Database;
  private lease: WriterLease;
  private closed = false;
  private closing?: Promise<void>;
  private snapshots = new Set<Promise<unknown>>();
  private constructor(
    root: string,
    readonly agentId: string,
    lease: WriterLease,
    generation: string,
    database: Database.Database,
  ) {
    this.root = root;
    this.lease = lease;
    this.generation = generation;
    this.database = database;
  }
  static async open(directory: string, agentId: string, signal?: AbortSignal): Promise<AgentState> {
    if (!uuid(agentId)) throw new StateFault('corrupt', 'Invalid Agent identity');
    const root = await privateDirectory(directory, signal);
    const lease = new WriterLease(root);
    const state = join(root, 'state');
    const generations = join(state, 'generations');
    const active = join(state, 'current.json');
    const initializing = join(state, 'initializing.json');
    let database: Database.Database | undefined;
    try {
      stateDirectory(state);
      stateDirectory(generations);
      let generation: string;
      if (existsSync(active)) generation = pointer(active, agentId);
      else if (existsSync(initializing)) generation = pointer(initializing, agentId);
      else {
        if (readdirSync(generations).length)
          throw new StateFault(
            'corrupt',
            'State pointer is missing; existing generations were retained',
          );
        generation = randomUUID();
        atomicPrivateJson(initializing, { version: 1, agentId, generation });
      }
      const folder = join(generations, generation);
      stateDirectory(folder);
      const file = join(folder, 'state.sqlite');
      if (existsSync(active) && !existsSync(file))
        throw new StateFault('corrupt', 'Active state database is missing');
      for (const suffix of ['', '-wal', '-shm']) assertRegularFile(file + suffix);
      await protectPrivatePaths(
        [
          join(root, 'writer.sqlite'),
          join(root, 'identity.json'),
          state,
          generations,
          active,
          initializing,
          folder,
          file,
          file + '-wal',
          file + '-shm',
        ],
        signal,
      );
      signal?.throwIfAborted();
      database = createDatabase(file, agentId, !existsSync(active));
      await protectPrivatePaths([file, file + '-wal', file + '-shm'], signal);
      signal?.throwIfAborted();
      if (!existsSync(active)) atomicPrivateJson(active, { version: 1, agentId, generation });
      if (existsSync(initializing) && pointer(initializing, agentId) === generation)
        rmSync(initializing);
      database
        .prepare("UPDATE operations SET state = 'unknown', finished_at = ? WHERE state = 'running'")
        .run(new Date().toISOString());
      return new AgentState(root, agentId, lease, generation, database);
    } catch (error) {
      database?.close();
      lease.close();
      throw error;
    }
  }
  document(name: string): JsonDocument {
    if (!/^[a-z][a-z0-9.-]{0,100}$/.test(name))
      throw new StateFault('corrupt', 'Invalid document name');
    let revision: string | null | undefined;
    return {
      read: () => {
        this.assertOpen();
        const row = this.database
          .prepare('SELECT revision, body FROM documents WHERE name = ?')
          .get(name) as { revision: string; body: string } | undefined;
        revision = row?.revision ?? null;
        return row ? JSON.parse(row.body) : null;
      },
      write: (value) => {
        this.assertOpen();
        if (revision === undefined)
          throw new StateFault('conflict', 'Read the document before writing');
        const next = randomUUID();
        const body = json(value);
        this.database
          .transaction(() => {
            const current = this.database
              .prepare('SELECT revision FROM documents WHERE name = ?')
              .get(name) as { revision: string } | undefined;
            if ((current?.revision ?? null) !== revision)
              throw new StateFault('conflict', 'State document changed; reload before saving');
            this.database
              .prepare(
                'INSERT INTO documents VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET revision=excluded.revision, body=excluded.body, updated_at=excluded.updated_at',
              )
              .run(name, next, body, new Date().toISOString());
          })
          .immediate();
        revision = next;
      },
    };
  }
  resource(kind: string, localKey: string): string {
    this.assertOpen();
    return this.database
      .transaction(() => {
        const row = this.database
          .prepare('SELECT id FROM resource_ids WHERE kind = ? AND local_key = ?')
          .get(kind, localKey) as { id: string } | undefined;
        if (row) return row.id;
        const id = randomUUID();
        this.database.prepare('INSERT INTO resource_ids VALUES (?, ?, ?)').run(id, kind, localKey);
        return id;
      })
      .immediate();
  }
  private assertOpen() {
    if (this.closed) throw new StateFault('unavailable', 'State store closed');
  }
  status(): StorageStatus {
    return {
      agentId: this.agentId,
      schemaVersion: SCHEMA_VERSION,
      generation: this.generation,
      writer: !this.closed,
    };
  }
  async backup(signal?: AbortSignal): Promise<string> {
    if (this.closed) throw new StateFault('unavailable', 'State store closed');
    if (this.snapshots.size) throw new StateFault('busy', 'A state snapshot is already running');
    const work = this.makeBackup(signal);
    this.snapshots.add(work);
    try {
      return await work;
    } finally {
      this.snapshots.delete(work);
    }
  }
  private async makeBackup(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    stateDirectory(join(this.root, 'backups'));
    const folder = join(this.root, 'backups', randomUUID());
    stateDirectory(folder);
    const file = join(folder, 'state.sqlite');
    try {
      await protectPrivatePaths([join(this.root, 'backups'), folder], signal);
      await this.database.backup(file, {
        progress() {
          signal?.throwIfAborted();
          return 100;
        },
      });
      signal?.throwIfAborted();
      const copy = new Database(file, { readonly: true, fileMustExist: true });
      try {
        checkDatabase(copy, this.agentId);
      } finally {
        copy.close();
      }
      const manifest: StateBackup = {
        version: 1,
        kind: 'agent-state-database',
        agentId: this.agentId,
        sourceGeneration: this.generation,
        createdAt: new Date().toISOString(),
        sha256: await hashFile(file, signal),
        schemaVersion: SCHEMA_VERSION,
      };
      await protectPrivatePaths([folder, file], signal);
      signal?.throwIfAborted();
      atomicPrivateJson(join(folder, 'manifest.json'), manifest);
      return folder;
    } catch (error) {
      rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await Promise.allSettled([...this.snapshots]);
      try {
        if (this.database.open) {
          try {
            this.database.pragma('wal_checkpoint(TRUNCATE)');
          } finally {
            this.database.close();
          }
        }
      } finally {
        if (!this.database.open) this.lease.close();
      }
    })();
    return this.closing;
  }
  static async restore(
    directory: string,
    agentId: string,
    backupDirectory: string,
    signal?: AbortSignal,
  ): Promise<{ generation: string; previous: string | null }> {
    if (!uuid(agentId)) throw new StateFault('corrupt', 'Invalid Agent identity');
    const root = await privateDirectory(directory, signal);
    const lease = new WriterLease(root);
    try {
      const backup = resolve(backupDirectory);
      const file = join(backup, 'state.sqlite');
      assertRegularFile(file);
      assertRegularFile(join(backup, 'manifest.json'));
      const manifest = JSON.parse(
        readFileSync(join(backup, 'manifest.json'), 'utf8'),
      ) as StateBackup;
      if (
        manifest.version !== 1 ||
        manifest.kind !== 'agent-state-database' ||
        manifest.agentId !== agentId ||
        manifest.schemaVersion !== SCHEMA_VERSION ||
        (await hashFile(file, signal)) !== manifest.sha256
      )
        throw new StateFault('corrupt', 'Backup checksum, schema or identity does not match');
      const source = new Database(file, { readonly: true, fileMustExist: true });
      try {
        checkDatabase(source, agentId);
      } finally {
        source.close();
      }
      const active = join(root, 'state/current.json');
      stateDirectory(join(root, 'state'));
      stateDirectory(join(root, 'state/generations'));
      let previous: string | null = null;
      if (existsSync(active)) {
        assertRegularFile(active);
        try {
          previous = pointer(active, agentId);
        } catch (error) {
          if (!(error instanceof StateFault) || error.kind !== 'corrupt') throw error;
          // Explicit restore can repair a damaged pointer, retaining its bytes.
        }
      }
      const initializing = join(root, 'state/initializing.json');
      stateDirectory(join(root, 'recovery'));
      await protectPrivatePaths([join(root, 'recovery')], signal);
      for (const marker of [active, initializing])
        if (existsSync(marker)) {
          assertRegularFile(marker);
          const retained = join(root, 'recovery', `${randomUUID()}.pointer.json`);
          copyFileSync(marker, retained);
          await protectPrivatePaths([retained], signal);
        }
      const generation = randomUUID();
      const folder = join(root, 'state/generations', generation);
      stateDirectory(folder);
      await protectPrivatePaths(
        [join(root, 'state'), join(root, 'state/generations'), folder],
        signal,
      );
      // Copy, validate and protect a fresh generation. Never mix old WAL/SHM with a new DB.
      const target = join(folder, 'state.sqlite');
      copyFileSync(file, target);
      const fd = openSync(target, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if ((await hashFile(target, signal)) !== manifest.sha256)
        throw new StateFault('corrupt', 'Backup changed while restoring');
      const restored = new Database(target, { readonly: true, fileMustExist: true });
      try {
        checkDatabase(restored, agentId);
      } finally {
        restored.close();
      }
      await protectPrivatePaths([folder, target], signal);
      signal?.throwIfAborted();
      atomicPrivateJson(active, { version: 1, agentId, generation });
      if (existsSync(initializing)) rmSync(initializing);
      return { generation, previous };
    } finally {
      lease.close();
    }
  }
}
