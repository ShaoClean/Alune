import {
  Injectable,
  Inject,
  NotFoundException,
  GatewayTimeoutException,
  BadRequestException,
} from '@nestjs/common';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { ConnectionService } from '../connection/connection.service';
import {
  DiffImages,
  GitCommands,
  GitWorktrees,
  RepositoryFiles,
  worktreePathKey,
  LocalConnection,
  runGit,
} from '@alune/ssh-client';
import type { RepositoryTransport } from '@alune/ssh-client';
import { REPOSITORY_STATUS_TIMEOUT_MS } from '@alune/shared';
import type {
  Repository,
  RepositoryStatus,
  DiffOptions,
  DiffImageContent,
  DiffImageOptions,
  LogOptions,
  RepositoryFilePreview,
  RepositoryTreeListing,
  RepositoryContext,
} from '@alune/shared';

@Injectable()
export class RepositoryService {
  private statusRequests = new Map<string, Promise<RepositoryStatus>>();

  private async withWorktrees<T>(
    id: string,
    operation: (
      repo: Repository,
      git: GitWorktrees,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new GatewayTimeoutException('Worktree 查询超时，请重试');
        controller.abort(error);
        reject(error);
      }, REPOSITORY_STATUS_TIMEOUT_MS);
    });
    const work = (async () => {
      const repo = await this.get(id);
      const connection = await this.connection(repo, controller.signal);
      controller.signal.throwIfAborted();
      return operation(repo, new GitWorktrees(connection), controller.signal);
    })();
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  getWorktrees(id: string) {
    return this.withWorktrees(id, (repo, git, signal) =>
      git.list(repo.path, signal),
    );
  }

  openWorktree(id: string, selectedPath: string): Promise<Repository> {
    return this.withWorktrees(id, async (repo, git, signal) => {
      const path = await git.resolve(repo.path, selectedPath, signal);
      if (repo.source === 'local') {
        signal.throwIfAborted();
        await this.get(id);
        return this.addLocal(path, signal, id);
      }
      const key = worktreePathKey(path);
      // Resolve aliases only during an explicit open; the local registry stays offline-capable.
      const repositories = await this.list(repo.connectionId);
      let existing = repositories.find(
        (item) => worktreePathKey(item.path) === key,
      );
      if (!existing) {
        for (const item of repositories) {
          try {
            if (
              worktreePathKey(await git.canonicalPath(item.path, signal)) ===
              key
            ) {
              existing = item;
              break;
            }
          } catch {
            signal.throwIfAborted();
            // An unrelated stale registration must not prevent opening a valid worktree.
          }
        }
      }
      signal.throwIfAborted();
      // No await between the last lookup and insert: opens from different parent
      // repositories/windows cannot create duplicate registrations.
      return this.db.transaction(() => {
        if (
          !this.db.prepare('SELECT id FROM repositories WHERE id = ?').get(id)
        )
          throw new NotFoundException('原仓库已被移除，请重新打开仓库列表。');
        if (
          existing &&
          this.db
            .prepare('SELECT id FROM repositories WHERE id = ?')
            .get(existing.id)
        )
          return existing;
        const row = this.db
          .prepare(
            'SELECT * FROM repositories WHERE connection_id = ? AND path = ? ORDER BY created_at, id LIMIT 1',
          )
          .get(repo.connectionId, path) as any;
        if (row) return this.fromRow(row);
        const registered: Repository = {
          id: uuidv4(),
          source: 'ssh',
          connectionId: repo.connectionId,
          name: this._repoName(path),
          path,
        };
        this.db
          .prepare(
            'INSERT INTO repositories (id, connection_id, name, path) VALUES (?, ?, ?, ?)',
          )
          .run(
            registered.id,
            registered.connectionId,
            registered.name,
            registered.path,
          );
        return registered;
      })();
    });
  }

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
        connection_id TEXT,
        source TEXT NOT NULL DEFAULT 'ssh' CHECK (source IN ('local', 'ssh')),
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        pinned INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (connection_id) REFERENCES connections(id)
      )
    `);
    const columns = this.db
      .prepare('PRAGMA table_info(repositories)')
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'source')) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE repositories_local_migration (
            id TEXT PRIMARY KEY,
            connection_id TEXT,
            source TEXT NOT NULL DEFAULT 'ssh' CHECK (source IN ('local', 'ssh')),
            name TEXT NOT NULL, path TEXT NOT NULL, pinned INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (connection_id) REFERENCES connections(id)
          );
          INSERT INTO repositories_local_migration (id, connection_id, source, name, path, pinned, created_at)
            SELECT id, connection_id, 'ssh', name, path, pinned, created_at FROM repositories;
          DROP TABLE repositories;
          ALTER TABLE repositories_local_migration RENAME TO repositories;
        `);
      })();
    }
  }

  private fromRow(row: any): Repository {
    return {
      id: row.id,
      source: row.source || 'ssh',
      ...(row.connection_id ? { connectionId: row.connection_id } : {}),
      name: row.name,
      path: row.path,
    };
  }

  async connection(
    repo: Repository,
    signal?: AbortSignal,
  ): Promise<RepositoryTransport> {
    if (repo.source === 'local') return new LocalConnection(signal);
    if (!repo.connectionId)
      throw new BadRequestException('远程仓库缺少 SSH 连接，请重新登记。');
    const connection = await this.connectionService.ensureConnected(
      repo.connectionId,
    );
    signal?.throwIfAborted();
    return signal
      ? {
          execCommand: (...args) => connection.execCommand(...args),
          withSftp: (operation) => connection.withSftp(operation),
          signal,
        }
      : connection;
  }

  async inspectLocal(input: string, parentSignal?: AbortSignal) {
    if (
      typeof input !== 'string' ||
      !input ||
      input.includes('\0') ||
      !isAbsolute(input)
    )
      throw new BadRequestException('请选择或输入本机的完整目录路径。');
    let path: string;
    try {
      path = await realpath(input);
      if (!(await stat(path)).isDirectory()) throw new Error('请选择目录。');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new BadRequestException(
        code === 'ENOENT'
          ? '目录不存在或已移走。'
          : code === 'EACCES' || code === 'EPERM'
            ? '没有读取此目录的权限。请检查系统权限或选择其他目录。'
            : '无法打开此目录，请检查路径。',
      );
    }
    const signal = parentSignal
      ? AbortSignal.any([
          parentSignal,
          AbortSignal.timeout(REPOSITORY_STATUS_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(REPOSITORY_STATUS_TIMEOUT_MS);
    const connection = new LocalConnection(signal);
    const result = await runGit(connection, path, [
      'rev-parse',
      '--show-toplevel',
    ]);
    if (result.exitCode !== 0)
      throw new BadRequestException(
        `不是可用的 Git 工作区；请选择已有仓库目录。${result.stderr}`,
      );
    path = await realpath(result.stdout.replace(/\r?\n$/, ''));
    const git = new GitCommands(connection);
    const status = await git.status(path, signal);
    const context = await this.readContext(
      { id: '', source: 'local', name: this._repoName(path), path },
      connection,
    );
    return { ...context, name: this._repoName(path), status };
  }

  async addLocal(
    input: string,
    signal?: AbortSignal,
    parentId?: string,
  ): Promise<Repository> {
    const inspected = await this.inspectLocal(input, signal);
    signal?.throwIfAborted();
    if (parentId) await this.get(parentId);
    signal?.throwIfAborted();
    const key = (path: string) =>
      process.platform === 'win32'
        ? worktreePathKey(path).toLowerCase()
        : worktreePathKey(path);
    return this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT * FROM repositories WHERE source = 'local'")
        .all() as any[];
      const existing = rows.find(
        (row) => key(row.path) === key(inspected.path),
      );
      if (existing) return this.fromRow(existing);
      const repo: Repository = {
        id: uuidv4(),
        source: 'local',
        name: inspected.name,
        path: inspected.path,
      };
      this.db
        .prepare(
          "INSERT INTO repositories (id, source, connection_id, name, path) VALUES (?, 'local', NULL, ?, ?)",
        )
        .run(repo.id, repo.name, repo.path);
      return repo;
    })();
  }

  async getContext(id: string): Promise<RepositoryContext> {
    const repo = await this.get(id);
    return this.readContext(
      repo,
      await this.connection(
        repo,
        AbortSignal.timeout(REPOSITORY_STATUS_TIMEOUT_MS),
      ),
    );
  }

  private async readContext(
    repo: Repository,
    connection: RepositoryTransport,
  ): Promise<RepositoryContext> {
    const read = async (args: string[], missing = false) => {
      const result = await runGit(connection, repo.path, args);
      if (result.exitCode !== 0 && !(missing && result.exitCode === 1))
        throw new Error(result.stderr || '无法读取 Git 配置。');
      return result.stdout.replace(/\r?\n$/, '');
    };
    const [name, email, shallow, status, remotes] = await Promise.all([
      read(['config', '--get', 'user.name'], true),
      read(['config', '--get', 'user.email'], true),
      read(['rev-parse', '--is-shallow-repository']),
      new GitCommands(connection).status(repo.path),
      new GitCommands(connection).remoteList(repo.path),
    ]);
    return {
      path: repo.path,
      source: repo.source || 'ssh',
      author: { name, email },
      shallow: shallow === 'true',
      unborn: !!status.unborn,
      upstream: status.upstream || '',
      remotes,
    };
  }

  private _quoteDouble(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private _powershellEncoded(command: string): string {
    return Buffer.from(command, 'utf16le').toString('base64');
  }

  private _buildWindowsScanCommand(
    searchPath: string,
    executable: 'powershell' | 'pwsh',
  ): string {
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
    return (
      repoPath
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() || repoPath
    );
  }

  async add(connectionId: string, repoPath: string): Promise<Repository> {
    const id = uuidv4();
    const name = this._repoName(repoPath);

    this.db
      .prepare(
        `
      INSERT INTO repositories (id, connection_id, name, path)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(id, connectionId, name, repoPath);

    return { id, source: 'ssh', connectionId, name, path: repoPath };
  }

  async list(connectionId?: string): Promise<Repository[]> {
    const query = connectionId
      ? 'SELECT * FROM repositories WHERE connection_id = ? ORDER BY pinned DESC, created_at'
      : 'SELECT * FROM repositories ORDER BY pinned DESC, created_at';
    const params = connectionId ? [connectionId] : [];

    const rows = this.db.prepare(query).all(...params) as any[];

    // Registration is local data. An offline host must never delay this response.
    return rows.map((row) => this.fromRow(row));
  }

  async get(id: string): Promise<Repository> {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE id = ?')
      .get(id) as any;
    if (!row) throw new NotFoundException(`Repository ${id} not found`);
    return this.fromRow(row);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id);
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    this.db
      .prepare('UPDATE repositories SET pinned = ? WHERE id = ?')
      .run(pinned ? 1 : 0, id);
  }

  getStatus(id: string): Promise<RepositoryStatus> {
    const pending = this.statusRequests.get(id);
    if (pending) return pending;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new GatewayTimeoutException('仓库状态查询超时，请重试');
        controller.abort(error);
        reject(error);
      }, REPOSITORY_STATUS_TIMEOUT_MS);
    });
    const work = (async () => {
      const repo = await this.get(id);
      const conn = await this.connection(repo);
      // A connection may finish after this request's deadline. Do not start Git then.
      controller.signal.throwIfAborted();
      return new GitCommands(conn).status(repo.path, controller.signal);
    })();
    const request = Promise.race([work, timeout]).finally(() => {
      clearTimeout(timer);
      this.statusRequests.delete(id);
    });
    this.statusRequests.set(id, request);
    return request;
  }

  async getLog(id: string, options?: LogOptions) {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    const git = new GitCommands(conn);
    return git.log(repo.path, options);
  }

  async getDiff(id: string, options?: DiffOptions) {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    const git = new GitCommands(conn);
    return git.diff(repo.path, options);
  }

  async getDiffImage(
    id: string,
    options: DiffImageOptions,
  ): Promise<DiffImageContent> {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    return new DiffImages(conn).read(repo.path, options);
  }

  async listTree(id: string, path: string): Promise<RepositoryTreeListing> {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    return new RepositoryFiles(conn).list(repo.path, path);
  }

  async readFile(id: string, path: string): Promise<RepositoryFilePreview> {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    return new RepositoryFiles(conn).read(repo.path, path);
  }

  async getCommitFiles(id: string, commit: string, parentCommit?: string) {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    const git = new GitCommands(conn);
    return git.commitFiles(repo.path, commit, parentCommit);
  }

  async getBranches(id: string) {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    const git = new GitCommands(conn);
    return git.branchList(repo.path);
  }

  async getStashes(id: string) {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    const git = new GitCommands(conn);
    return git.stashList(repo.path);
  }

  async getRemotes(id: string) {
    const repo = await this.get(id);
    const conn = await this.connection(repo);
    const git = new GitCommands(conn);
    return git.remoteList(repo.path);
  }
}
