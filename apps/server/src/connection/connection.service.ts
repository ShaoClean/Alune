import {
  Injectable,
  Inject,
  NotFoundException,
  OnModuleDestroy,
  Optional,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { HostConnections } from '@alune/agent/host-connections';
import { SSHConnection } from '@alune/ssh-client';
import type {
  ConnectionActivityStatus,
  ConnectionStatusInfo,
  ConnectionTestResult,
  SSHConnectionConfig,
} from '@alune/shared';
import { ProxyService } from '../proxy/proxy.service';
import type { ProxyConnectionStatus } from '@alune/shared';
import { EventsGateway } from '../events/events.gateway';
import { TerminalRegistry } from '../terminal/terminal-registry';
import { logger } from '../logging/logger';

@Injectable()
export class ConnectionService implements OnModuleDestroy {
  private hosts: HostConnections;

  constructor(
    @Inject('DATABASE') private db: Database.Database,
    private events: EventsGateway,
    @Optional() private proxy?: ProxyService,
    @Optional() private terminals?: TerminalRegistry,
  ) {
    this._initTable();
    this.hosts = new HostConnections(
      (id) => this.get(id),
      () => this.proxy?.settings.snapshot(),
      (id, { status, error, updatedAt }) => {
        this.events.emitConnectionStatus(id, status, error, updatedAt);
        this._logStatus(id, status, error);
      },
    );
  }

  private _logStatus(
    id: string,
    status: ConnectionActivityStatus,
    error?: string,
  ) {
    let target: { name?: string; host?: string; port?: number } | undefined;
    try {
      target = this.db
        .prepare('SELECT name, host, port FROM connections WHERE id = ?')
        .get(id) as typeof target;
    } catch {}
    const context = {
      connectionId: id,
      ...target,
      ...(error ? { error } : {}),
    };
    if (status === 'error') logger.error('ssh', 'SSH 连接失败', context);
    else if (status === 'connecting')
      logger.debug('ssh', '正在建立 SSH 连接', context);
    else if (status === 'connected') logger.info('ssh', 'SSH 已连接', context);
    else if (status === 'disconnected')
      logger.info('ssh', 'SSH 已断开', context);
  }

  getStatus(id: string): ConnectionStatusInfo {
    return this.hosts.getStatus(id);
  }

  onModuleDestroy() {
    this.hosts.close();
  }

  private _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'password',
        password TEXT,
        private_key_path TEXT,
        passphrase TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  async create(
    config: Omit<SSHConnectionConfig, 'id'>,
  ): Promise<SSHConnectionConfig & { id: string }> {
    const id = uuidv4();
    this.db
      .prepare(
        `
      INSERT INTO connections (id, name, host, port, username, auth_type, password, private_key_path, passphrase)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        config.name,
        config.host,
        config.port || 22,
        config.username,
        config.authType,
        config.password || null,
        config.privateKeyPath || null,
        config.passphrase || null,
      );

    return { id, ...config };
  }

  async list(): Promise<(SSHConnectionConfig & { id: string })[]> {
    const rows = this.db
      .prepare('SELECT * FROM connections ORDER BY created_at')
      .all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      password: row.password || undefined,
      privateKeyPath: row.private_key_path || undefined,
      passphrase: row.passphrase || undefined,
    }));
  }

  async get(id: string): Promise<SSHConnectionConfig & { id: string }> {
    const row = this.db
      .prepare('SELECT * FROM connections WHERE id = ?')
      .get(id) as any;
    if (!row) throw new NotFoundException(`Connection ${id} not found`);
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      password: row.password || undefined,
      privateKeyPath: row.private_key_path || undefined,
      passphrase: row.passphrase || undefined,
    };
  }

  async delete(id: string, terminalSessionIds?: string[]): Promise<void> {
    this.terminals?.remove({ connectionId: id }, terminalSessionIds);
    this.hosts.remove(id);
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  }

  async test(id: string): Promise<ConnectionTestResult> {
    // Preserve the controller's 404 behavior for unknown connection IDs.
    await this.get(id);
    try {
      // Reuse the pooled connection so an explicit test and an opened repository
      // report one status, and testing never drops a connection already in use.
      await this.ensureConnected(id);
      const status = this.getStatus(id);
      return {
        success: true,
        status: status.status,
        updatedAt: status.updatedAt,
      };
    } catch (err: any) {
      const status = this.getStatus(id);
      return {
        success: false,
        status: status.status,
        error: status.error || err.message,
        updatedAt: status.updatedAt,
      };
    }
  }

  async proxyStatuses(): Promise<ProxyConnectionStatus[]> {
    const revision = this.proxy?.settings.read().revision;
    return (await this.list()).map(({ id, name }) => {
      const connection = this.hosts.pool.getConnection(id);
      return {
        id,
        name,
        connected: connection?.connected ?? false,
        connecting: connection?.connecting ?? false,
        revision: connection?.proxyRevision ?? null,
        pendingReconnect: Boolean(
          connection && revision && connection.proxyRevision !== revision,
        ),
        activeTasks: connection?.activeTasks ?? 0,
        forwarding: connection?.forwarding ?? 'disconnected',
        error: connection?.forwardingError,
      };
    });
  }

  async reconnectProxy(id: string, revision: string) {
    this.proxy?.settings.assertRevision(revision);
    await this.get(id);
    const current = this.hosts.pool.getConnection(id);
    if (
      this.hosts.connecting.has(id) ||
      current?.connecting ||
      current?.activeTasks
    )
      throw new ConflictException(
        '此服务器仍有运行中任务或正在连接，请结束任务后重试。',
      );
    this.hosts.pool.removeConnection(id);
    await this.ensureConnected(id);
    return this.proxyStatuses();
  }

  async testSavedProxy(id: string, signal?: AbortSignal) {
    const config = await this.get(id);
    const connection = new SSHConnection({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKeyPath: config.privateKeyPath,
      passphrase: config.passphrase,
      proxy: this.proxy?.settings.snapshot(),
    });
    connection.on('error', () => {});
    const abort = () => connection.disconnect();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      await connection.connect();
    } finally {
      signal?.removeEventListener('abort', abort);
      connection.disconnect();
    }
  }

  getConnection(id: string): SSHConnection | undefined {
    return this.hosts.pool.getConnection(id);
  }

  ensureConnected(id: string) {
    return this.hosts.ensureConnected(id);
  }
}
