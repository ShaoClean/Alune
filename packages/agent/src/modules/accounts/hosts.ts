import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { HostProfile, HostProfilesResult, SaveHostProfile } from '@alune/protocol';
import type { SqlDatabase } from '../../ports/sql';
import { StateFault, type SecretCipher } from '../../ports/state';

type HostRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: HostProfile['authType'];
  private_key_path: string | null;
  password_secret: string | null;
  passphrase_secret: string | null;
  created_at: string;
  updated_at: string;
};
const revisionKey = 'hostProfilesRevision';
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
export function validateHostInput(value: unknown): asserts value is SaveHostProfile {
  const input = value as SaveHostProfile | null;
  if (
    !input ||
    !text(input.name, 256) ||
    !text(input.host, 253) ||
    !text(input.username, 256) ||
    !Number.isInteger(input.port) ||
    input.port < 1 ||
    input.port > 65535 ||
    !['password', 'privateKey', 'sshAgent'].includes(input.authType) ||
    (input.privateKeyPath !== null && !text(input.privateKeyPath, 32768)) ||
    (!isIP(input.host) && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(domainToASCII(input.host)))
  )
    throw new StateFault('invalid-input', 'Invalid host profile fields');
  for (const secret of [input.password, input.passphrase])
    if (
      secret !== undefined &&
      secret !== null &&
      (typeof secret !== 'string' ||
        !secret ||
        Buffer.byteLength(secret) > 65536 ||
        secret.includes('\0'))
    )
      throw new StateFault('invalid-input', 'Invalid host credential');
}
export function initializeHostProfiles(db: SqlDatabase): void {
  if (db.prepare('SELECT value FROM agent_meta WHERE key = ?').get(revisionKey)) return;
  if (db.prepare('SELECT id FROM connections LIMIT 1').get())
    throw new StateFault('corrupt', 'Host profile revision is missing; existing data was retained');
  db.prepare('INSERT INTO agent_meta VALUES (?, ?)').run(revisionKey, randomUUID());
}
export function encryptHostCredential(
  cipher: SecretCipher,
  id: string,
  input: SaveHostProfile,
  kind: 'password' | 'passphrase',
  secret: string,
): string {
  if (!cipher.available)
    throw new StateFault('unavailable', 'Host credential storage is unavailable');
  return cipher.encrypt(
    JSON.stringify({
      hostId: id,
      host: input.host,
      port: input.port,
      username: input.username,
      privateKeyPath: kind === 'passphrase' ? input.privateKeyPath : null,
      kind,
      secret,
    }),
  );
}
export class HostProfilesStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly secrets: SecretCipher,
  ) {}
  private revision(): string {
    return (
      this.db.prepare('SELECT value FROM agent_meta WHERE key = ?').get(revisionKey) as {
        value: string;
      }
    ).value;
  }
  private row(id: string): HostRow {
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as
      | HostRow
      | undefined;
    if (!row) throw new StateFault('not-found', 'Host profile does not exist');
    return row;
  }
  list(): HostProfilesResult {
    const rows = this.db
      .prepare('SELECT * FROM connections ORDER BY created_at, id')
      .all() as HostRow[];
    return {
      revision: this.revision(),
      hosts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type,
        privateKeyPath: row.private_key_path,
        hasPassword: Boolean(row.password_secret),
        hasPassphrase: Boolean(row.passphrase_secret),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      secretStorage: { available: this.secrets.available, description: this.secrets.description },
    };
  }
  private mutate(revision: unknown, run: () => void): HostProfilesResult {
    try {
      this.db
        .transaction(() => {
          if (revision !== this.revision())
            throw new StateFault('conflict', 'Host profiles changed; reload before saving');
          run();
          this.db
            .prepare('UPDATE agent_meta SET value = ? WHERE key = ?')
            .run(randomUUID(), revisionKey);
        })
        .immediate();
    } catch (error) {
      if (error instanceof StateFault) throw error;
      throw new StateFault(
        'unavailable',
        'Host profile write failed; reread the state before retrying',
        'unknown',
      );
    }
    return this.list();
  }
  save(id: string | null, input: SaveHostProfile, revision: string): HostProfilesResult {
    validateHostInput(input);
    return this.mutate(revision, () => {
      const previous = id ? this.row(id) : undefined;
      const hostId = id ?? randomUUID();
      const protect = (kind: 'password' | 'passphrase') => {
        const secret = input[kind];
        if (secret === null) return null;
        if (secret !== undefined)
          return encryptHostCredential(this.secrets, hostId, input, kind, secret);
        const retained =
          kind === 'password' ? previous?.password_secret : previous?.passphrase_secret;
        if (
          retained &&
          (input.host !== previous!.host ||
            input.port !== previous!.port ||
            input.username !== previous!.username ||
            (kind === 'passphrase' && input.privateKeyPath !== previous!.private_key_path))
        )
          throw new StateFault(
            'conflict',
            'Changing a host credential destination requires replacing or clearing that credential',
          );
        return retained ?? null;
      };
      const password = protect('password'),
        passphrase = protect('passphrase');
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO connections VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,auth_type=excluded.auth_type,private_key_path=excluded.private_key_path,password_secret=excluded.password_secret,passphrase_secret=excluded.passphrase_secret,updated_at=excluded.updated_at`,
        )
        .run(
          hostId,
          input.name,
          input.host,
          input.port,
          input.username,
          input.authType,
          input.privateKeyPath,
          password,
          passphrase,
          previous?.created_at ?? now,
          now,
        );
      if (!previous)
        this.db
          .prepare('INSERT INTO resource_ids VALUES (?, ?, ?)')
          .run(hostId, 'host-profile', hostId);
    });
  }
  delete(id: string, revision: string, repositories?: string[]): HostProfilesResult {
    return this.mutate(revision, () => {
      this.row(id);
      if (repositories) {
        const rows = this.db
          .prepare('SELECT id FROM repositories WHERE connection_id=?')
          .all(id) as { id: string }[];
        const expected = new Set(repositories);
        if (rows.length !== expected.size || rows.some((r) => !expected.has(r.id)))
          throw new StateFault('conflict', '服务器仓库已变化，请重新确认移除。');
        this.db.prepare('DELETE FROM repositories WHERE connection_id=?').run(id);
      } else if (
        this.db.prepare('SELECT id FROM repositories WHERE connection_id = ? LIMIT 1').get(id)
      )
        throw new StateFault(
          'conflict',
          'Remove registered repositories before deleting their host profile',
        );
      this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
      // Keep the identity mapping as a tombstone; IDs must not be reassigned.
    });
  }
  /** Internal SSH adapter port. Never registered as a read RPC. */
  credential(id: string) {
    const row = this.row(id);
    const decrypt = (kind: 'password' | 'passphrase') => {
      const encrypted = kind === 'password' ? row.password_secret : row.passphrase_secret;
      if (!encrypted) return undefined;
      try {
        const value = JSON.parse(this.secrets.decrypt(encrypted));
        if (
          value.hostId !== id ||
          value.kind !== kind ||
          value.host !== row.host ||
          value.port !== row.port ||
          value.username !== row.username ||
          (kind === 'passphrase' && value.privateKeyPath !== row.private_key_path) ||
          typeof value.secret !== 'string'
        )
          throw Error();
        return value.secret as string;
      } catch {
        throw new StateFault(
          'unavailable',
          'Host credential cannot be decrypted for this destination',
        );
      }
    };
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      ...(row.auth_type === 'password' ? { password: decrypt('password') } : {}),
      ...(row.auth_type === 'privateKey'
        ? { privateKeyPath: row.private_key_path ?? undefined, passphrase: decrypt('passphrase') }
        : {}),
    };
  }
}
