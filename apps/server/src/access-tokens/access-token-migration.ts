import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { SecretStorage } from '../secrets/secret-storage';

// Only called for the desktop's explicit first import of the standalone database.
// Keep every original ciphertext if either key store is unavailable; the UI can offer replacement.
export function migrateImportedAccessTokens(
  db: Database.Database,
  source: SecretStorage,
  destination: SecretStorage,
): boolean {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'access_token_secrets'",
      )
      .get()
  )
    return true;
  const rows = db
    .prepare(
      "SELECT token_id, ciphertext FROM access_token_secrets WHERE ciphertext LIKE 'aes-gcm:%'",
    )
    .all() as { token_id: string; ciphertext: string }[];
  if (!rows.length) return true;
  if (!source.available || !destination.available) return false;
  try {
    db.transaction(() => {
      for (const row of rows) {
        const ciphertext = destination.encrypt(source.decrypt(row.ciphertext));
        db.prepare(
          'UPDATE access_token_secrets SET ciphertext = ? WHERE token_id = ?',
        ).run(ciphertext, row.token_id);
        db.prepare('UPDATE access_tokens SET version = ? WHERE id = ?').run(
          randomUUID(),
          row.token_id,
        );
      }
      db.prepare('UPDATE access_token_state SET revision = ? WHERE id = 1').run(
        randomUUID(),
      );
    }).immediate();
    return true;
  } catch {
    return false;
  }
}
