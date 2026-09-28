import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  AccessToken,
  AccessTokenSettings,
  ApplyAccessToken,
  PullRequestProvider,
  PullRequestRemote,
  PullRequestSelection,
} from '@alune/shared';
import { SECRET_STORAGE } from '../secrets/secrets.module';
import type { SecretStorage } from '../secrets/secret-storage';
import { EventsGateway } from '../events/events.gateway';

type TokenRow = {
  id: string;
  name: string;
  version: string;
  updated_at: string;
  provider: PullRequestProvider | null;
  origin: string | null;
};
type BindingRow = {
  target: string;
  provider: PullRequestProvider;
  token_id: string | null;
  invalid_reason: 'target-changed' | 'token-deleted' | null;
  version: string;
};

export function tokenValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\s\x00-\x1f\x7f]/.test(value)
  )
    throw new BadRequestException(
      '令牌值必填，最多 4096 个字符，不能包含空白字符。',
    );
  return value;
}

@Injectable()
export class AccessTokensService {
  constructor(
    @Inject('DATABASE') private readonly db: Database.Database,
    @Inject(SECRET_STORAGE) private readonly secrets: SecretStorage,
    private readonly events: EventsGateway,
  ) {
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
    db.prepare('INSERT OR IGNORE INTO access_token_state VALUES (1, ?)').run(
      randomUUID(),
    );
  }

  private revision(): string {
    return (
      this.db
        .prepare('SELECT revision FROM access_token_state WHERE id = 1')
        .get() as { revision: string }
    ).revision;
  }

  private bump() {
    this.db
      .prepare('UPDATE access_token_state SET revision = ? WHERE id = 1')
      .run(randomUUID());
  }

  private changed() {
    this.events.server?.emit('access-tokens:changed');
  }

  private mutate(revision: unknown, work: () => void): AccessTokenSettings {
    try {
      this.db
        .transaction(() => {
          if (typeof revision !== 'string' || revision !== this.revision())
            throw new ConflictException(
              '令牌或仓库关联已变化，请重新加载并确认后重试。',
            );
          work();
          this.bump();
        })
        .immediate();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        '访问令牌保存失败，请检查应用数据目录后重试。',
      );
    }
    this.changed();
    return this.list();
  }

  list(): AccessTokenSettings {
    return this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT * FROM access_tokens ORDER BY name_key')
        .all() as TokenRow[];
      const associations = this.db
        .prepare(
          `SELECT b.token_id, b.repository_id AS repositoryId, r.name AS repositoryName, b.remote, b.target
        FROM access_token_bindings b JOIN repositories r ON r.id = b.repository_id
        WHERE b.token_id IS NOT NULL ORDER BY r.name, b.remote`,
        )
        .all() as (AccessToken['associations'][number] & {
        token_id: string;
      })[];
      return {
        revision: this.revision(),
        tokens: rows.map((row) => ({
          id: row.id,
          name: row.name,
          version: row.version,
          updatedAt: row.updated_at,
          scope:
            row.provider && row.origin
              ? { provider: row.provider, origin: row.origin }
              : null,
          associations: associations
            .filter((a) => a.token_id === row.id)
            .map(({ token_id: _, ...a }) => a),
        })),
        secretStorage: {
          available: this.secrets.available,
          description: this.secrets.description,
        },
      };
    })();
  }

  private row(id: string): TokenRow {
    const row = this.db
      .prepare('SELECT * FROM access_tokens WHERE id = ?')
      .get(id) as TokenRow | undefined;
    if (!row) throw new NotFoundException('原令牌已删除，请重新选择。');
    return row;
  }

  save(id: string | null, input: unknown): AccessTokenSettings {
    const body = input as {
      name?: unknown;
      value?: unknown;
      revision?: unknown;
    } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 50 || /[\x00-\x1f\x7f]/.test(name))
      throw new BadRequestException('令牌名称必填，最多 50 个字符。');
    const value =
      !id || body?.value !== undefined ? tokenValue(body?.value) : undefined;
    return this.mutate(body?.revision, () => {
      if (id) this.row(id);
      if (
        this.db
          .prepare(
            'SELECT id FROM access_tokens WHERE name_key = ? AND id != ?',
          )
          .get(name.toLowerCase(), id || '')
      )
        throw new ConflictException('此令牌名称已存在，请使用其他名称。');
      let ciphertext: string | undefined;
      if (value !== undefined) {
        try {
          if (!this.secrets.available) throw new Error();
          ciphertext = this.secrets.encrypt(value);
        } catch {
          throw new ServiceUnavailableException(
            '加密存储不可用，令牌未保存。请恢复本机密钥存储；仍可匿名读取或仅本次输入。',
          );
        }
      }
      const tokenId = id || randomUUID();
      const version = randomUUID();
      const now = new Date().toISOString();
      if (id)
        this.db
          .prepare(
            'UPDATE access_tokens SET name = ?, name_key = ?, version = ?, updated_at = ? WHERE id = ?',
          )
          .run(name, name.toLowerCase(), version, now, id);
      else
        this.db
          .prepare(
            'INSERT INTO access_tokens (id, name, name_key, version, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(tokenId, name, name.toLowerCase(), version, now);
      if (ciphertext !== undefined)
        this.db
          .prepare('INSERT OR REPLACE INTO access_token_secrets VALUES (?, ?)')
          .run(tokenId, ciphertext);
    });
  }

  delete(id: string, input: unknown): AccessTokenSettings {
    return this.mutate(
      (input as { revision?: unknown } | null)?.revision,
      () => {
        this.row(id);
        this.db
          .prepare(
            "UPDATE access_token_bindings SET token_id = NULL, invalid_reason = 'token-deleted', version = ? WHERE token_id = ?",
          )
          .run(randomUUID(), id);
        this.db.prepare('DELETE FROM access_tokens WHERE id = ?').run(id);
      },
    );
  }

  private binding(
    repositoryId: string,
    remote: string,
  ): BindingRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM access_token_bindings WHERE repository_id = ? AND remote = ?',
      )
      .get(repositoryId, remote) as BindingRow | undefined;
  }

  // Once a changed/deleted destination is observed, reverting Git config must not revive credentials.
  reconcile(repositoryId: string, remotes: PullRequestRemote[]) {
    const changed = this.db
      .transaction(() => {
        const rows = this.db
          .prepare(
            'SELECT * FROM access_token_bindings WHERE repository_id = ?',
          )
          .all(repositoryId) as (BindingRow & { remote: string })[];
        let count = 0;
        for (const row of rows) {
          const remote = remotes.find((r) => r.name === row.remote);
          if (
            row.invalid_reason ||
            (remote &&
              !remote.unavailableReason &&
              row.target === remote.webUrl &&
              (!remote.provider || remote.provider === row.provider))
          )
            continue;
          this.db
            .prepare(
              "UPDATE access_token_bindings SET token_id = NULL, invalid_reason = 'target-changed', version = ? WHERE repository_id = ? AND remote = ?",
            )
            .run(randomUUID(), repositoryId, row.remote);
          count++;
        }
        if (count) this.bump();
        return count > 0;
      })
      .immediate();
    if (changed) this.changed();
  }

  selection(
    repositoryId: string,
    remote: PullRequestRemote,
  ): PullRequestSelection {
    const row = this.binding(repositoryId, remote.name);
    if (!row)
      return { status: 'none', tokenId: null, provider: null, version: '' };
    return {
      status: row.invalid_reason || 'applied',
      tokenId: row.invalid_reason ? null : row.token_id,
      provider: row.invalid_reason === 'target-changed' ? null : row.provider,
      version: `${row.version}:${row.token_id ? this.row(row.token_id).version : ''}`,
    };
  }

  // Caller has re-read Git config and checked this exact target/provider before entering the transaction.
  apply(
    repositoryId: string,
    remote: PullRequestRemote,
    input: ApplyAccessToken,
  ): AccessTokenSettings {
    if (
      input.tokenId !== null &&
      (typeof input.tokenId !== 'string' || input.tokenId.length > 100)
    )
      throw new BadRequestException('请选择有效令牌或不使用令牌。');
    return this.mutate(input.revision, () => {
      if (
        !this.db
          .prepare('SELECT id FROM repositories WHERE id = ?')
          .get(repositoryId)
      )
        throw new NotFoundException('仓库已被移除。');
      if (input.tokenId !== null) {
        const row = this.row(input.tokenId);
        const origin = new URL(remote.webUrl).origin;
        if (
          row.origin &&
          (row.origin !== origin || row.provider !== input.provider)
        )
          throw new ConflictException(
            '此令牌已关联其他平台或主机（含端口），请另建令牌或重新选择。',
          );
        // Fail before binding if the credential cannot be restored on this device.
        this.decrypt(row.id);
        if (!row.origin)
          this.db
            .prepare(
              'UPDATE access_tokens SET origin = ?, provider = ?, version = ? WHERE id = ?',
            )
            .run(origin, input.provider, randomUUID(), row.id);
      }
      this.db
        .prepare(
          `INSERT OR REPLACE INTO access_token_bindings
        (repository_id, remote, target, provider, token_id, invalid_reason, version) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          repositoryId,
          remote.name,
          remote.webUrl,
          input.provider,
          input.tokenId,
          randomUUID(),
        );
    });
  }

  private decrypt(id: string): string {
    try {
      if (!this.secrets.available) throw new Error();
      const row = this.db
        .prepare(
          'SELECT ciphertext FROM access_token_secrets WHERE token_id = ?',
        )
        .get(id) as { ciphertext: string } | undefined;
      if (!row) throw new Error();
      return tokenValue(this.secrets.decrypt(row.ciphertext));
    } catch {
      throw new ServiceUnavailableException(
        '已保存的令牌无法解密，请恢复本机密钥存储或在管理令牌中更换值；仍可仅本次输入或选择不使用令牌。',
      );
    }
  }

  credential(
    repositoryId: string,
    remote: PullRequestRemote,
    provider: PullRequestProvider,
  ) {
    const binding = this.binding(repositoryId, remote.name);
    if (
      binding &&
      (binding.invalid_reason ||
        binding.target !== remote.webUrl ||
        binding.provider !== provider)
    )
      throw new ConflictException(
        binding.invalid_reason === 'token-deleted'
          ? '原令牌已删除，请重新选择并应用。'
          : '远端目标或平台已变化，请重新选择并应用。',
      );
    const row = binding?.token_id ? this.row(binding.token_id) : null;
    if (
      row &&
      (row.origin !== new URL(remote.webUrl).origin ||
        row.provider !== provider)
    )
      throw new ConflictException('令牌与当前目标不匹配，请重新选择。');
    return {
      token: row ? this.decrypt(row.id) : '',
      assertCurrent: () => {
        const current = this.binding(repositoryId, remote.name);
        const token = row
          ? (this.db
              .prepare('SELECT version FROM access_tokens WHERE id = ?')
              .get(row.id) as { version: string } | undefined)
          : null;
        if (
          current?.version !== binding?.version ||
          (row && token?.version !== row.version)
        )
          throw new ConflictException('令牌或仓库关联已变化，请刷新后重试。');
      },
    };
  }
}
