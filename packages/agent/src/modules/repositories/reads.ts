import type { RepositoryContext, RepositoryStatus } from '@alune/domain';
import {
  ProtocolError,
  type RepositoryQuery,
  type RepositoryResource,
  type RepositorySnapshot,
} from '@alune/protocol';
import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import type { RepositoryTransport } from '../../ports/repository-files';
import { GitOperationReads } from '../git/conflict-resolution';
import { DiffImages } from '../git/diff-images';
import { GitBlame } from '../git/git-blame';
import { GitReads } from '../git/git-commands';
import { GitSigningReads } from '../git/git-signing';
import { GitTagReads } from '../git/git-tags';
import { GitLfs } from '../git/lfs';
import { PartialReads } from '../git/partial-changes';
import { collectRepositoryAnalytics } from '../git/repository-analytics';
import { RepositoryFiles } from '../git/repository-files';
import { joinRepositoryPath } from '../git/repository-path';
import { runGit } from '../git/repository-transport';
import { readSftpChunks } from '../git/sftp-file';
import { GitSubmoduleReads } from '../git/submodules';
import { GitWorktrees } from '../git/worktrees';

export class RepositoryReader {
  readonly git: GitReads;
  constructor(readonly connection: RepositoryTransport) {
    this.git = new GitReads(connection);
  }
  private async text(path: string, args: string[], missing = false) {
    const result = await runGit(this.connection, path, args);
    if (result.exitCode !== 0 && !(missing && result.exitCode === 1))
      throw new Error(result.stderr || '无法读取仓库');
    return result.stdout.replace(/\r?\n$/, '');
  }
  async inspect(input: string) {
    if (!isAbsolute(input))
      throw new ProtocolError('invalid-params', 'Repository path must be absolute');
    const worktrees = new GitWorktrees(this.connection);
    const canonical = await worktrees.canonicalPath(input);
    const root = await this.text(canonical, ['rev-parse', '--show-toplevel']);
    const path = await worktrees.canonicalPath(root);
    const worktreeKind = await worktrees.kind(path);
    const status = await this.status(path);
    const context = await this.context(path, status);
    return { ...context, name: basename(path) || path, worktreeKind, status };
  }
  async context(path: string, existingStatus?: RepositoryStatus): Promise<RepositoryContext> {
    // Await all subprocesses before leaving the read, including a failed config.
    const tasks = await Promise.allSettled([
      this.text(path, ['config', '--get', 'user.name'], true),
      this.text(path, ['config', '--get', 'user.email'], true),
      this.text(path, ['rev-parse', '--is-shallow-repository']),
      existingStatus ? Promise.resolve(existingStatus) : this.git.status(path),
      this.git.remoteList(path),
    ] as const);
    const [name, email, shallow, status, remotes] = tasks.map((r) => {
      if (r.status === 'rejected') throw r.reason;
      return r.value;
    }) as [string, string, string, RepositoryStatus, Awaited<ReturnType<GitReads['remoteList']>>];
    return {
      path,
      source: 'local',
      author: { name, email },
      shallow: shallow === 'true',
      unborn: !!status.unborn,
      upstream: status.upstream ?? '',
      remotes,
    };
  }
  async status(path: string): Promise<RepositoryStatus> {
    // Both projections refer to the same worktree-specific Git directory.
    // Common repositories have no commondir file; linked and unusual layouts
    // still use Git's canonical comparison, including paths containing newlines.
    const gitDirectory = this.text(path, ['rev-parse', '--absolute-git-dir']);
    const settled = await Promise.allSettled([
      this.git.status(path, this.connection.signal, false),
      gitDirectory.then(async (dir) => {
        if (
          this.connection.hasAnyPath &&
          !(await this.connection.hasAnyPath([joinRepositoryPath(dir, 'commondir')]))
        )
          return 'main' as const;
        return new GitWorktrees(this.connection).kind(
          path,
          AbortSignal.any([
            ...(this.connection.signal ? [this.connection.signal] : []),
            AbortSignal.timeout(1500),
          ]),
        );
      }),
      gitDirectory.then((dir) =>
        new GitOperationReads(this.connection).stateInGitDirectory(
          path,
          dir,
          this.connection.signal,
        ),
      ),
    ] as const);
    this.connection.signal?.throwIfAborted();
    if (settled[0].status === 'rejected') throw settled[0].reason;
    return {
      ...settled[0].value,
      ...(settled[1].status === 'fulfilled' ? { worktreeKind: settled[1].value } : {}),
      ...(settled[2].status === 'fulfilled' && settled[2].value
        ? { operation: settled[2].value }
        : {}),
    };
  }
  async snapshot(repo: RepositoryResource): Promise<RepositorySnapshot> {
    const before = await this.snapshotOnce(repo);
    const after = await this.snapshotOnce(repo);
    if (before.revision !== after.revision)
      throw new ProtocolError('conflict', 'HEAD or index changed during snapshot');
    return after;
  }
  private async snapshotOnce(repo: RepositoryResource): Promise<RepositorySnapshot> {
    const path = repo.path;
    const gitDirectory = await this.text(path, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ]);
    const commonDirectory = await this.text(path, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    const index = await this.text(path, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'index',
    ]);
    const head =
      (await this.text(path, ['rev-parse', '--verify', '--quiet', 'HEAD'], true)) || null;
    const hash = createHash('sha256');
    await this.connection.withSftp(async (files) => {
      try {
        let bytes = 0;
        for await (const chunk of readSftpChunks(files, index)) {
          this.connection.signal?.throwIfAborted();
          bytes += chunk.length;
          if (bytes > 128 * 1024 * 1024)
            throw new ProtocolError('overloaded', 'Repository index exceeds snapshot budget');
          hash.update(chunk);
        }
      } catch (error) {
        const code = (error as { code?: string | number }).code;
        if (code !== 'ENOENT' && code !== 2) throw error;
        hash.update('absent');
      }
    });
    const indexDigest = hash.digest('hex');
    const revision = createHash('sha256')
      .update(JSON.stringify([repo.resource, gitDirectory, commonDirectory, head, indexDigest]))
      .digest('hex');
    return { resource: repo.resource, gitDirectory, commonDirectory, head, indexDigest, revision };
  }
  async discover(path: string, depth = 4): Promise<{ paths: string[]; truncated: boolean }> {
    if (!isAbsolute(path))
      throw new ProtocolError('invalid-params', 'Discovery path must be absolute');
    return this.connection.withSftp(async (files) => {
      const root = await promisify(files.realpath.bind(files))(path);
      const paths: string[] = [];
      let visited = 0,
        truncated = false;
      const visit = async (directory: string, level: number) => {
        this.connection.signal?.throwIfAborted();
        if (++visited > 10000 || paths.length >= 1000) {
          truncated = true;
          return;
        }
        const entries = await promisify(files.readdir.bind(files))(directory);
        if (entries.some((e) => e.filename === '.git')) paths.push(directory);
        if (level >= depth) return;
        for (const entry of entries) {
          if (
            entry.filename === '.git' ||
            entry.filename === '.' ||
            entry.filename === '..' ||
            entry.filename.includes('/') ||
            entry.filename.includes('\0')
          )
            continue;
          const child = joinRepositoryPath(directory, entry.filename);
          const stats = await promisify(files.lstat.bind(files))(child);
          if (stats.isDirectory() && !stats.isSymbolicLink()) await visit(child, level + 1);
          if (truncated) return;
        }
      };
      await visit(root, 0);
      return { paths: paths.sort(), truncated };
    });
  }
  async query(repo: RepositoryResource, query: RepositoryQuery): Promise<unknown> {
    const path = repo.path;
    switch (query.kind) {
      case 'status':
        return this.status(path);
      case 'context':
        return this.context(path);
      case 'previewRebase':
        return new (await import('../git/interactive-rebase')).InteractiveRebase(
          this.connection,
        ).preview(path, query.params.base);
      case 'rebaseState':
        return new (await import('../git/interactive-rebase')).InteractiveRebase(
          this.connection,
        ).state(path);
      case 'rebaseConflict':
        return new (await import('../git/interactive-rebase')).InteractiveRebase(
          this.connection,
        ).conflict(path, query.params.path);
      case 'previewWorkspaceFile':
        return new (await import('../git/workspace-file-actions')).WorkspaceFileActions(
          this.connection,
        ).preview(path, query.params.path);
      case 'previewNewFileDeletion':
        return new (await import('../git/new-file-deletion')).NewFileDeletion(
          this.connection,
        ).preview(path, query.params.path);
      case 'previewDiscardChanges':
        return {
          ...(await new (await import('../git/discard-changes')).DiscardChanges(
            this.connection,
          ).preview(path)),
          repositoryName: repo.name,
        };
      case 'snapshot':
        return this.snapshot(repo);
      case 'worktrees':
        return new GitWorktrees(this.connection).list(path);
      case 'branches':
        return this.git.branchList(path);
      case 'remotes':
        return this.git.remoteList(path);
      case 'stashes':
        return this.git.stashList(path);
      case 'stashDiff': {
        const result = await runGit(
          this.connection,
          path,
          [
            'stash',
            'show',
            '--patch',
            '--include-untracked',
            '--no-ext-diff',
            '--no-textconv',
            `stash@{${query.params.index}}`,
          ],
          undefined,
          { maxOutputBytes: 1024 * 1024, strictUtf8: true },
        );
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return result.stdout;
      }
      case 'tags': {
        const tags = new GitTagReads(this.connection);
        const local = await tags.list(path);
        return {
          local,
          ...(query.params.remote
            ? { remote: await tags.remoteTags(path, query.params.remote) }
            : {}),
        };
      }
      case 'log':
        return this.git.log(path, query.params);
      case 'diff':
        return this.git.diff(path, query.params);
      case 'editableDiff':
        return new PartialReads(this.connection).preview(
          path,
          query.params.file,
          query.params.staged,
          query.params.fullFile,
        );
      case 'diffImage':
        return new DiffImages(this.connection).read(path, query.params);
      case 'commitFiles':
        return this.git.commitFiles(path, query.params.commit, query.params.parentCommit);
      case 'tree':
        return new RepositoryFiles(this.connection).list(path, query.params.path);
      case 'file':
        return new RepositoryFiles(this.connection).read(path, query.params.path);
      case 'blame':
        return new GitBlame(this.connection).read(path, query.params, this.connection.signal);
      case 'blameCommit':
        return new GitBlame(this.connection).commit(
          path,
          query.params.hash,
          this.connection.signal,
        );
      case 'analytics':
        return collectRepositoryAnalytics(
          this.connection,
          path,
          query.params.endDay,
          this.connection.signal,
        );
      case 'signing':
        return new GitSigningReads(this.connection).read(path);
      case 'signatures':
        return new GitSigningReads(this.connection).signatures(path, query.params.hashes);
      case 'submodules':
        return new GitSubmoduleReads(this.connection).list(path);
      case 'lfs':
        return new GitLfs(this.connection).status(path);
    }
  }
}
