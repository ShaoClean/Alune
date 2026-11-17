import { randomUUID } from 'node:crypto';
import type { SqlDatabase } from '../../ports/sql';
import { StateFault } from '../../ports/state';

/** New Agent tables are created/validated by the state schema owner. */
export function initializeAgentAccessTokens(db: SqlDatabase): void {
  if (db.prepare('SELECT revision FROM access_token_state WHERE id = 1').get()) return;
  if (
    db.prepare('SELECT id FROM access_tokens LIMIT 1').get() ||
    db.prepare('SELECT repository_id FROM access_token_bindings LIMIT 1').get()
  )
    throw new StateFault(
      'corrupt',
      'Access token revision is missing; existing state was retained',
    );
  db.prepare('INSERT INTO access_token_state VALUES (1, ?)').run(randomUUID());
}

/** Compatibility initialization for an existing standalone database. */
export function initializeAccessTokenTables(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_token_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS access_tokens (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL, updated_at TEXT NOT NULL, provider TEXT, origin TEXT
    );
    CREATE TABLE IF NOT EXISTS access_token_secrets (
    token_id TEXT PRIMARY KEY REFERENCES access_tokens(id) ON DELETE CASCADE, ciphertext TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_token_bindings (
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    remote TEXT NOT NULL, target TEXT NOT NULL, provider TEXT NOT NULL,
    token_id TEXT REFERENCES access_tokens(id) ON DELETE SET NULL,
    invalid_reason TEXT, version TEXT NOT NULL, PRIMARY KEY(repository_id, remote)
    );
  `);
  db.prepare('INSERT OR IGNORE INTO access_token_state VALUES (1, ?)').run(randomUUID());
}
