import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { ConnectionService } from '../connection/connection.service';
import { GitCommands } from '@remote-git/ssh-client';
import type { Repository, CommitInfo, FileStatus, BranchInfo, StashEntry, RemoteInfo, DiffOptions, LogOptions } from '@remote-git/shared';

@Injectable()
export class RepositoryService {
  constructor(
    @Inject('DATABASE') private db: Database.Database,
    private connectionService: ConnectionService,
  ) {
    this._initTable();
  }

  private _initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        pinned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (connection_id) REFERENCES connections(id)
      )
    `);
  }

  private _quoteDouble(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private _powershellEncoded(command: string): string {
    return Buffer.from(command, 'utf16le').toString('base64');
  }

  private _buildWindowsScanCommand(searchPath: string, executable: 'powershell' | 'pwsh'): string {
    const literalPath = searchPath.replace(/'/g, "''");
    const script = [
      '$ErrorActionPreference = "SilentlyContinue"',
      `$items = Get-ChildItem -LiteralPath '${literalPath}' -Directory -Force -Recurse -Depth 3 -Filter '.git'`,
      '$items | ForEach-Object { $_.FullName -replace "[\\\\/]\\.git$", "" }',
    ].join('; ');

    return `${executable} -NoProfile -NonInteractive -EncodedCommand ${this._powershellEncoded(script)}`;
  }

  private _buildUnixScanCommand(searchPath: string): string {
    return `find ${this._quoteDouble(searchPath)} -maxdepth 4 -type d -name .git 2>/dev/null`;
  }

  private _stripGitDirectory(repoPath: string): string {
    return repoPath.replace(/[\\/]\.git$/, '');
  }

  async scan(connectionId: string, searchPath: string): Promise<string[]> {
    const conn = await this.connectionService.ensureConnected(connectionId);

    const commands = [
      this._buildWindowsScanCommand(searchPath, 'powershell'),
      this._buildWindowsScanCommand(searchPath, 'pwsh'),
      this._buildUnixScanCommand(searchPath),
    ];

    for (const command of commands) {
      const result = await conn.execCommand(command);
      if (result.exitCode === 0) {
        return result.stdout
          .split(/\r?\n/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => this._stripGitDirectory(p));
      }
    }

    return [];
  }

  private _repoName(repoPath: string): string {
    return repoPath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || repoPath;
  }

  async add(connectionId: string, repoPath: string): Promise<Repository> {
    const id = uuidv4();
    const name = this._repoName(repoPath);

    this.db.prepare(`
      INSERT INTO repositories (id, connection_id, name, path)
      VALUES (?, ?, ?, ?)
    `).run(id, connectionId, name, repoPath);

    return { id, connectionId, name, path: repoPath };
  }

  async list(connectionId?: string): Promise<Repository[]> {
    const query = connectionId
      ? 'SELECT * FROM repositories WHERE connection_id = ? ORDER BY pinned DESC, created_at'
      : 'SELECT * FROM repositories ORDER BY pinned DESC, created_at';
    const params = connectionId ? [connectionId] : [];

    const rows = this.db.prepare(query).all(...params) as any[];

    const repositories: Repository[] = [];
    for (const row of rows) {
      const repo: Repository = {
        id: row.id,
        connectionId: row.connection_id,
        name: row.name,
        path: row.path,
      };
      try {
        const conn = await this.connectionService.ensureConnected(row.connection_id);
        const git = new GitCommands(conn);
        const status = await git.status(row.path);
        repo.currentBranch = status.branch;
        repo.ahead = status.ahead;
        repo.behind = status.behind;
        repo.isDirty = status.files.length > 0;
      } catch {}
      repositories.push(repo);
    }
    return repositories;
  }

  async get(id: string): Promise<Repository> {
    const row = this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as any;
    if (!row) throw new NotFoundException(`Repository ${id} not found`);
    return {
      id: row.id,
      connectionId: row.connection_id,
      name: row.name,
      path: row.path,
    };
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    this.db.prepare('UPDATE repositories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  }

  async getStatus(id: string) {
    const repo = await this.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    const git = new GitCommands(conn);
    return git.status(repo.path);
  }

  async getLog(id: string, options?: LogOptions) {
    const repo = await this.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    const git = new GitCommands(conn);
    return git.log(repo.path, options);
  }

  async getDiff(id: string, options?: DiffOptions) {
    const repo = await this.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    const git = new GitCommands(conn);
    return git.diff(repo.path, options);
  }

  async getBranches(id: string) {
    const repo = await this.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    const git = new GitCommands(conn);
    return git.branchList(repo.path);
  }

  async getStashes(id: string) {
    const repo = await this.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    const git = new GitCommands(conn);
    return git.stashList(repo.path);
  }

  async getRemotes(id: string) {
    const repo = await this.get(id);
    const conn = await this.connectionService.ensureConnected(repo.connectionId);
    const git = new GitCommands(conn);
    return git.remoteList(repo.path);
  }
}
