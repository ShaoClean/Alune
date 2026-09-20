import { Injectable, Inject, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { SSHConnectionPool, SSHConnection } from '@remote-git/ssh-client';
import type {
  ConnectionActivityStatus,
  ConnectionStatusInfo,
  ConnectionTestResult,
  SSHConnectionConfig,
} from '@remote-git/shared';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class ConnectionService implements OnModuleDestroy {
  private pool = new SSHConnectionPool();
  private connecting = new Map<string, Promise<SSHConnection>>();
  private statuses = new Map<string, ConnectionStatusInfo>();
  private readonly startedAt = Date.now();
  private lastStatusAt = this.startedAt;

  constructor(
    @Inject('DATABASE') private db: Database.Database,
    private events: EventsGateway,
  ) {
    this._initTable();
    // SSH activity is the single source of truth for the status shown in the UI.
    this.pool.on('connection:connecting', (id: string) => this._setStatus(id, 'connecting'));
    this.pool.on('connection:connected', (id: string) => this._setStatus(id, 'connected'));
    this.pool.on('connection:disconnected', (id: string) => {
      // ssh2 closes the socket right after reporting an error; keep the specific
      // failure instead of replacing it with a bare "disconnected".
      if (this.statuses.get(id)?.status !== 'error') this._setStatus(id, 'disconnected');
    });
    this.pool.on('connection:error', (id: string, error: Error) =>
      this._setStatus(id, 'error', error?.message),
    );
  }

  private _setStatus(id: string, status: ConnectionActivityStatus, error?: string) {
    const current = this.statuses.get(id);
    // ensureConnected reports the attempt before ssh2 does; do not emit it twice.
    if (current && current.status === status && current.error === error) return current;
    const updatedAt = Math.max(Date.now(), this.lastStatusAt + 1);
    this.lastStatusAt = updatedAt;
    const info: ConnectionStatusInfo = { status, error, updatedAt };
    this.statuses.set(id, info);
    this.events.emitConnectionStatus(id, status, error, info.updatedAt);
    return info;
  }

  getStatus(id: string): ConnectionStatusInfo {
    return this.statuses.get(id) ?? { status: 'unknown', updatedAt: this.startedAt };
  }

  onModuleDestroy() {
    this.pool.disconnectAll();
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

  async create(config: Omit<SSHConnectionConfig, 'id'>): Promise<SSHConnectionConfig & { id: string }> {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO connections (id, name, host, port, username, auth_type, password, private_key_path, passphrase)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, config.name, config.host, config.port || 22, config.username, config.authType, config.password || null, config.privateKeyPath || null, config.passphrase || null);

    return { id, ...config };
  }

  async list(): Promise<(SSHConnectionConfig & { id: string })[]> {
    const rows = this.db.prepare('SELECT * FROM connections ORDER BY created_at').all() as any[];
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
    const row = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as any;
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

  async delete(id: string): Promise<void> {
    this.pool.removeConnection(id);
    this.statuses.delete(id);
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
      return { success: true, status: status.status, updatedAt: status.updatedAt };
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

  getConnection(id: string): SSHConnection | undefined {
    return this.pool.getConnection(id);
  }

  async ensureConnected(id: string): Promise<SSHConnection> {
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const existing = this.pool.getConnection(id);
    if (existing?.connected) return existing;
    // Report the attempt immediately: reading the config or the key file happens
    // before ssh2 can emit anything of its own.
    this._setStatus(id, 'connecting');
    const request = (async () => {
      const config = await this.get(id);
      const conn = this.pool.createConnection(id, {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKeyPath: config.privateKeyPath,
        passphrase: config.passphrase,
      });
      await conn.connect();
      return conn;
    })()
      .catch((error: any) => {
        // A failure before ssh2 reports one of its own errors (unknown connection,
        // unreadable key file) must not leave the status stuck on "connecting".
        if (this.statuses.get(id)?.status === 'connecting')
          this._setStatus(id, 'error', error?.message);
        throw error;
      })
      .finally(() => this.connecting.delete(id));
    // Concurrent status reads for one host must share its connection attempt.
    this.connecting.set(id, request);
    return request;
  }
}
