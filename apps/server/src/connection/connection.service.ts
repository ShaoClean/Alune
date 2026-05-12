import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { SSHConnectionPool, SSHConnection } from '@remote-git/ssh-client';
import type { SSHConnectionConfig } from '@remote-git/shared';

@Injectable()
export class ConnectionService {
  private pool = new SSHConnectionPool();

  constructor(@Inject('DATABASE') private db: Database.Database) {
    this._initTable();
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
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  }

  async test(id: string): Promise<{ success: boolean; error?: string }> {
    const config = await this.get(id);
    try {
      const conn = this.pool.createConnection(id, {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKeyPath: config.privateKeyPath,
        passphrase: config.passphrase,
      });
      await conn.connect();
      conn.disconnect();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  getConnection(id: string): SSHConnection | undefined {
    return this.pool.getConnection(id);
  }

  async ensureConnected(id: string): Promise<SSHConnection> {
    let conn = this.pool.getConnection(id);
    if (!conn || !conn.connected) {
      const config = await this.get(id);
      conn = this.pool.createConnection(id, {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKeyPath: config.privateKeyPath,
        passphrase: config.passphrase,
      });
      await conn.connect();
    }
    return conn;
  }
}