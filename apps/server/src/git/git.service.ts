import {
  Injectable,
  HttpException,
  ConflictException,
  BadRequestException,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  isAbsolute,
  relative,
  resolve,
  dirname,
  basename,
  sep,
} from 'node:path';
import { realpath } from 'node:fs/promises';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import {
  WorkspaceFileActions,
  RepositoryFileError,
  GitCommands,
  PartialChanges,
  PartialChangesError,
  GitTags,
  LocalConnection,
  NewFileDeletion,
  NewFileDeletionError,
  validateNewFilePath,
  DiscardChanges,
  DiscardChangesError,
  validateDiscardChangesRequest,
  validateRepositoryPath,
  GitWorktrees,
  worktreePathKey,
  runGit,
  assertFileChanges,
  ignoreDirectory,
  InteractiveRebase,
  ConflictResolution,
  ConflictResolutionError,
} from '@alune/ssh-client';
import type { RepositoryTransport } from '@alune/ssh-client';
import type {
  PartialDiffRequest,
  ConflictBlockChoice,
  ConflictSide,
  DiscardChangesScope,
  Repository,
  SwitchBranchResult,
  BranchNameConflict,
  CreateTagOptions,
  DeleteTagOptions,
  PushTagOptions,
  CheckoutTagOptions,
  RebaseRequest,
  RebaseResolution,
} from '@alune/shared';

type Operation = {
  controller: AbortController;
  kind: string;
  startedAt: number;
};
@Injectable()
export class GitService implements OnModuleDestroy {
  private readonly active = new Map<string, Operation>();
  onModuleDestroy() {
    for (const operation of this.active.values())
      operation.controller.abort(new Error('Alune 正在关闭，Git 操作已取消。'));
  }
  constructor(
    private connectionService: ConnectionService,
    private repoService: RepositoryService,
  ) {}

  private async transport(
    repo: Repository,
    signal?: AbortSignal,
  ): Promise<RepositoryTransport> {
    if (repo.source === 'local') return new LocalConnection(signal);
    if (!repo.connectionId)
      throw new BadRequestException('远程仓库缺少 SSH 连接。');
    const connecting = this.connectionService.ensureConnected(
      repo.connectionId,
    );
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal?.reason || new Error('Git 操作已取消。'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    const connection: RepositoryTransport = await (
      signal ? Promise.race([connecting, cancelled]) : connecting
    ).finally(() => {
      if (abort) signal?.removeEventListener('abort', abort);
    });
    signal?.throwIfAborted();
    return {
      signal,
      hasAnyPath: connection.hasAnyPath?.bind(connection),
      execGit: connection.execGit?.bind(connection),
      execCommand: (...args) => connection.execCommand(...args),
      withSftp: (operation) => connection.withSftp(operation),
    };
  }

  private async write<T>(
    id: string,
    kind: string,
    operation: (
      git: GitCommands,
      repo: Repository,
      connection: RepositoryTransport,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.active.has(id))
      throw new ConflictException(
        '此仓库正在执行 Git 操作，请等待完成或取消后重试。',
      );
    const controller = new AbortController();
    this.active.set(id, { controller, kind, startedAt: Date.now() });
    const timer = setTimeout(
      () => controller.abort(new Error('Git 操作超时，请检查仓库状态后重试。')),
      5 * 60_000,
    );
    timer.unref();
    let release: (() => void) | undefined;
    try {
      const repo = await this.repoService.get(id);
      const connection = await this.transport(repo, controller.signal);
      if (repo.connectionId)
        release = this.connectionService
          .getConnection?.(repo.connectionId)
          ?.holdTask?.();
      controller.signal.throwIfAborted();
      if (
        ![
          'stage',
          'unstage',
          'interactive-rebase',
          'rebase-conflict',
          'resolve-conflict',
          'conflict-continue',
          'conflict-skip',
          'conflict-abort',
        ].includes(kind) &&
        (await new InteractiveRebase(connection).state(repo.path)).managed
      )
        throw new ConflictException(
          '请先完成或中止当前交互式变基，再执行其他 Git 操作。',
        );
      return await operation(new GitCommands(connection), repo, connection);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (kind === 'delete-file')
        throw new HttpException(
          error instanceof Error ? error.message : '文件删除失败。',
          502,
        );
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Git 操作失败，请刷新仓库状态后重试。',
      );
    } finally {
      clearTimeout(timer);
      release?.();
      this.active.delete(id);
    }
  }

  operation(id: string) {
    const active = this.active.get(id);
    return active
      ? {
          kind: active.kind,
          startedAt: active.startedAt,
          cancelling: active.controller.signal.aborted,
        }
      : null;
  }

  cancel(id: string) {
    this.active
      .get(id)
      ?.controller.abort(
        new Error('Git 操作已取消；已完成的步骤不会回滚，请刷新仓库状态。'),
      );
    return { success: true };
  }

  private value(value: unknown, label: string): string {
    if (
      typeof value !== 'string' ||
      !value ||
      value.includes('\0') ||
      value.startsWith('-')
    )
      throw new BadRequestException(`无效的${label}。`);
    return value;
  }
  private files(repo: Repository, files: string[]) {
    if (!Array.isArray(files) || !files.length)
      throw new BadRequestException('请选择文件。');
    files.forEach((file) => validateRepositoryPath(repo.path, file));
    return files;
  }
  private stashRef(index: number = 0) {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new BadRequestException('无效的储藏编号。');
    return `stash@{${index}}`;
  }
  private async checked(git: GitCommands, path: string, args: string[]) {
    const result = await git.execute(path, args);
    if (result.exitCode !== 0)
      throw new Error(
        result.stderr || result.stdout || 'Git 操作未完成，请刷新状态后重试。',
      );
    return { success: true, stdout: result.stdout };
  }

  private async readRebase<T>(
    id: string,
    action: (rebase: InteractiveRebase, path: string) => Promise<T>,
  ) {
    try {
      const repo = await this.repoService.get(id);
      return await action(
        new InteractiveRebase(
          await this.transport(repo, AbortSignal.timeout(60_000)),
        ),
        repo.path,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        error instanceof Error ? error.message : '无法读取变基状态。',
      );
    }
  }

  previewRebase(id: string, base: string) {
    return this.readRebase(id, (rebase, path) => rebase.preview(path, base));
  }

  rebaseState(id: string) {
    return this.readRebase(id, (rebase, path) => rebase.state(path));
  }

  startRebase(id: string, request: RebaseRequest) {
    return this.write(id, 'interactive-rebase', (_git, repo, connection) =>
      new InteractiveRebase(connection).start(repo.path, request),
    );
  }

  controlRebase(id: string, action: 'continue' | 'skip' | 'abort') {
    return this.write(id, 'interactive-rebase', (_git, repo, connection) =>
      new InteractiveRebase(connection).control(repo.path, action),
    );
  }

  rebaseConflict(id: string, path: string) {
    return this.readRebase(id, (rebase, root) => rebase.conflict(root, path));
  }

  resolveRebaseConflict(id: string, request: RebaseResolution) {
    return this.write(id, 'rebase-conflict', (_git, repo, connection) =>
      new InteractiveRebase(connection).resolve(repo.path, request),
    );
  }
  private async branch(git: GitCommands, path: string, name: string) {
    this.value(name, '分支名称');
    await this.checked(git, path, ['check-ref-format', '--branch', name]);
    return name;
  }

  async deleteNewFile(
    id: string,
    path: string,
    token?: string,
    preview = false,
  ) {
    try {
      validateNewFilePath(path);
      if (preview) {
        const repo = await this.repoService.get(id);
        return await new NewFileDeletion(await this.transport(repo)).preview(
          repo.path,
          path,
        );
      }
      return await this.write(
        id,
        'delete-file',
        async (_git, repo, connection) => {
          try {
            return await new NewFileDeletion(connection).delete(
              repo.path,
              path,
              token!,
            );
          } catch (error) {
            if (error instanceof NewFileDeletionError)
              throw new HttpException(error.message, error.statusCode);
            throw error;
          }
        },
      );
    } catch (error) {
      if (error instanceof NewFileDeletionError)
        throw new HttpException(error.message, error.statusCode);
      throw error;
    }
  }

  async previewWorkspaceFile(id: string, path: string) {
    const repo = await this.repoService.get(id);
    try {
      return await new WorkspaceFileActions(await this.transport(repo)).preview(
        repo.path,
        path,
      );
    } catch (error) {
      if (error instanceof RepositoryFileError)
        throw new HttpException(error.message, error.statusCode);
      throw error;
    }
  }

  mutateWorkspaceFile(
    id: string,
    path: string,
    token: string,
    action: 'delete' | 'rename',
    name?: string,
  ) {
    return this.write(id, 'workspace-file', async (_git, repo, connection) => {
      try {
        return await new WorkspaceFileActions(connection).mutate(
          repo.path,
          path,
          token,
          action,
          name,
        );
      } catch (error) {
        if (error instanceof RepositoryFileError)
          throw new HttpException(error.message, error.statusCode);
        throw error;
      }
    });
  }

  partialDiff(id: string, request: PartialDiffRequest) {
    return this.write(
      id,
      request?.action === 'stage' || request?.action === 'unstage'
        ? request.action
        : 'partial-diff',
      async (_git, repo, connection) => {
        try {
          return await new PartialChanges(connection).apply(repo.path, request);
        } catch (error) {
          if (error instanceof PartialChangesError)
            throw new HttpException(error.message, error.statusCode);
          throw error;
        }
      },
    );
  }

  stage(id: string, files: string[]) {
    return this.write(id, 'stage', async (git, repo) => {
      await git.stage(repo.path, this.files(repo, files));
      return { success: true };
    });
  }
  unstage(id: string, files: string[]) {
    return this.write(id, 'unstage', async (git, repo) => {
      await git.unstage(repo.path, this.files(repo, files));
      return { success: true };
    });
  }
  commit(id: string, message: string, description?: string) {
    return this.write(id, 'commit', async (git, repo) => {
      if (
        typeof message !== 'string' ||
        !message.trim() ||
        (description !== undefined && typeof description !== 'string')
      )
        throw new BadRequestException('请填写有效的提交信息。');
      const result = await git.commit(
        repo.path,
        description ? `${message}\n\n${description}` : message,
      );
      if (result.exitCode !== 0)
        throw new Error(result.stderr || result.stdout);
      return { success: true, stdout: result.stdout };
    });
  }
  push(
    id: string,
    remote?: string,
    branch?: string,
    force?: boolean,
    setUpstream?: boolean,
    tags?: boolean,
  ) {
    return this.write(id, 'push', async (git, repo) => {
      for (const option of [force, setUpstream, tags])
        if (option !== undefined && typeof option !== 'boolean')
          throw new BadRequestException('无效的推送选项。');
      if (setUpstream && (!remote || !branch))
        throw new BadRequestException('请选择远程与上游分支。');
      if (branch && !remote)
        throw new BadRequestException('请选择推送的远程。');
      let ref =
        branch === undefined
          ? undefined
          : await this.branch(git, repo.path, branch);
      if (setUpstream) {
        const current = await git.execute(repo.path, [
          'symbolic-ref',
          '--quiet',
          'HEAD',
        ]);
        const head = await git.execute(repo.path, [
          'rev-parse',
          '--verify',
          'HEAD',
        ]);
        if (current.exitCode !== 0 || head.exitCode !== 0)
          throw new BadRequestException(
            '请先切换到本地分支并创建提交，再设置上游。',
          );
        ref = `${current.stdout.trim()}:refs/heads/${ref}`;
      }
      return this.checked(git, repo.path, [
        'push',
        ...(tags ? ['--tags'] : []),
        ...(force ? ['--force-with-lease'] : []),
        ...(setUpstream ? ['--set-upstream'] : []),
        ...(remote ? [this.value(remote, '远程名称')] : []),
        ...(ref ? [ref] : []),
      ]);
    });
  }
  pull(id: string, remote?: string, branch?: string) {
    return this.write(id, 'pull', (git, repo) =>
      this.checked(git, repo.path, [
        'pull',
        '--no-edit',
        ...(remote ? [this.value(remote, '远程名称')] : []),
        ...(branch ? [this.value(branch, '分支名称')] : []),
      ]),
    );
  }
  fetch(id: string, remote?: string) {
    return this.write(id, 'fetch', (git, repo) =>
      this.checked(git, repo.path, [
        'fetch',
        ...(remote ? [this.value(remote, '远程名称')] : []),
      ]),
    );
  }
  deepen(id: string, remote: string = 'origin') {
    return this.write(id, 'fetch-history', (git, repo) =>
      this.checked(git, repo.path, [
        'fetch',
        '--unshallow',
        this.value(remote, '远程名称'),
      ]),
    );
  }
  async tags(id: string, remote?: string) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('读取标签超时，请重试。')),
      30_000,
    );
    timer.unref();
    try {
      const repo = await this.repoService.get(id);
      const tags = new GitTags(await this.transport(repo, controller.signal));
      return remote === undefined
        ? await tags.list(repo.path)
        : await tags.remoteTags(repo.path, remote);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        error instanceof Error ? error.message : '无法读取标签。',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  createTag(id: string, options: CreateTagOptions) {
    return this.write(id, 'create-tag', (_git, repo, connection) =>
      new GitTags(connection).create(repo.path, options),
    );
  }

  deleteTag(id: string, options: DeleteTagOptions) {
    return this.write(id, 'delete-tag', (_git, repo, connection) =>
      new GitTags(connection).delete(repo.path, options),
    );
  }

  pushTag(id: string, options: PushTagOptions) {
    return this.write(id, 'push-tag', (_git, repo, connection) =>
      new GitTags(connection).push(repo.path, options),
    );
  }

  checkoutTag(id: string, options: CheckoutTagOptions) {
    return this.write(id, 'checkout-tag', (_git, repo, connection) =>
      new GitTags(connection).checkout(repo.path, options),
    );
  }

  createBranch(id: string, name: string, checkout?: boolean) {
    return this.write(id, 'create-branch', async (git, repo) =>
      this.checked(git, repo.path, [
        ...(checkout ? ['checkout', '-b'] : ['branch']),
        await this.branch(git, repo.path, name),
      ]),
    );
  }
  switchBranch(
    id: string,
    name: string,
    localName?: string,
    isRemote?: boolean,
  ): Promise<SwitchBranchResult> {
    return this.write(id, 'switch-branch', async (git, repo) => {
      const options = { localName, isRemote };
      this.value(name, '分支名称');
      if (
        options.isRemote !== undefined &&
        typeof options.isRemote !== 'boolean'
      )
        throw new BadRequestException('无效的分支类型。');
      // Full refs avoid ambiguous short names and preserve literal local names.
      const { stdout } = await this.checked(git, repo.path, [
        'for-each-ref',
        '--format=%(refname)%00%(upstream)%00%(HEAD)',
        'refs/heads/',
      ]);
      const locals = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [ref, upstream, head] = line.split('\0');
          return {
            name: ref.slice('refs/heads/'.length),
            upstream,
            current: head === '*',
          };
        });
      const local = locals.find((branch) => branch.name === name);
      const remoteSelected =
        options.isRemote ?? (!local && /^(refs\/)?remotes\//.test(name));
      const switchLocal = async (
        branch: string,
      ): Promise<SwitchBranchResult> => {
        const result = await this.checked(git, repo.path, [
          'switch',
          '--no-guess',
          '--',
          branch,
        ]);
        return { success: true, branch, stdout: result.stdout };
      };
      if (!remoteSelected) {
        if (options.localName !== undefined)
          throw new BadRequestException('只有远程分支可指定新的本地分支名称。');
        if (!local)
          throw new BadRequestException(
            `本地分支“${name}”已不存在，请刷新分支列表。`,
          );
        return switchLocal(name);
      }
      if (!/^(refs\/)?remotes\//.test(name))
        throw new BadRequestException('请选择完整的远程分支引用。');
      const remoteRef = name.startsWith('refs/') ? name : `refs/${name}`;
      await this.checked(git, repo.path, ['check-ref-format', remoteRef]);
      const refs = await this.checked(git, repo.path, [
        'for-each-ref',
        '--format=%(refname)%00%(symref)',
        remoteRef,
      ]);
      if (!refs.stdout.split('\n').includes(`${remoteRef}\0`))
        throw new BadRequestException(
          `远程分支“${name}”已失效或不是分支，请先获取并刷新列表。`,
        );
      // A remote name may itself contain slashes; use the configured names.
      const remotes = await this.checked(git, repo.path, ['remote']);
      const remote = remotes.stdout
        .split('\n')
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .find((candidate) =>
          remoteRef.startsWith(`refs/remotes/${candidate}/`),
        );
      if (!remote)
        throw new BadRequestException(
          `远程分支“${name}”没有对应的远程配置，请刷新列表。`,
        );
      const tracking = locals.filter((branch) => branch.upstream === remoteRef);
      if (options.localName === undefined && tracking.length) {
        const target = tracking.find((branch) => branch.current) || tracking[0];
        return switchLocal(target.name);
      }
      const targetName =
        options.localName === undefined
          ? remoteRef.slice(`refs/remotes/${remote}/`.length)
          : this.value(options.localName, '本地分支名称');
      this.value(targetName, '本地分支名称');
      await this.checked(git, repo.path, [
        'check-ref-format',
        `refs/heads/${targetName}`,
      ]);
      const conflict = locals.find((branch) => branch.name === targetName);
      if (conflict) {
        if (conflict.upstream === remoteRef) return switchLocal(conflict.name);
        throw new ConflictException({
          code: 'LOCAL_BRANCH_EXISTS',
          message: `本地分支“${targetName}”已存在，但未跟踪所选远程分支。请选择切换到现有分支或换个名称创建。`,
          remoteRef,
          localName: targetName,
          upstream: conflict.upstream || undefined,
        } satisfies BranchNameConflict);
      }
      // switch -c is transactional: checkout conflicts leave no branch or upstream behind.
      const result = await this.checked(git, repo.path, [
        'switch',
        '--track',
        '-c',
        targetName,
        '--',
        remoteRef,
      ]);
      return { success: true, branch: targetName, stdout: result.stdout };
    });
  }
  renameBranch(id: string, name: string, newName: string) {
    return this.write(id, 'rename-branch', async (git, repo) =>
      this.checked(git, repo.path, [
        'branch',
        '-m',
        await this.branch(git, repo.path, name),
        await this.branch(git, repo.path, newName),
      ]),
    );
  }
  deleteBranch(id: string, name: string, force?: boolean) {
    return this.write(id, 'delete-branch', async (git, repo) =>
      this.checked(git, repo.path, [
        'branch',
        force === true ? '-D' : '-d',
        await this.branch(git, repo.path, name),
      ]),
    );
  }
  merge(id: string, branch: string) {
    return this.write(id, 'merge', (git, repo) =>
      this.checked(git, repo.path, [
        'merge',
        '--no-edit',
        this.value(branch, '分支名称'),
      ]),
    );
  }
  rebase(id: string, branch: string) {
    return this.write(id, 'rebase', (git, repo) =>
      this.checked(git, repo.path, ['rebase', this.value(branch, '分支名称')]),
    );
  }
  stash(id: string, message?: string, includeUntracked?: boolean) {
    return this.write(id, 'stash', (git, repo) => {
      if (
        includeUntracked !== undefined &&
        typeof includeUntracked !== 'boolean'
      )
        throw new BadRequestException('无效的未跟踪文件选项。');
      if (
        message !== undefined &&
        (typeof message !== 'string' || message.includes('\0'))
      )
        throw new BadRequestException('无效的储藏说明。');
      return this.checked(git, repo.path, [
        'stash',
        'push',
        ...(includeUntracked ? ['--include-untracked'] : []),
        ...(message ? ['-m', message] : []),
      ]);
    });
  }
  stashPop(id: string, index?: number) {
    return this.write(id, 'stash-pop', (git, repo) =>
      this.checked(git, repo.path, ['stash', 'pop', this.stashRef(index)]),
    );
  }
  stashApply(id: string, index?: number) {
    return this.write(id, 'stash-apply', (git, repo) =>
      this.checked(git, repo.path, ['stash', 'apply', this.stashRef(index)]),
    );
  }
  stashDrop(id: string, index?: number) {
    return this.write(id, 'stash-drop', (git, repo) =>
      this.checked(git, repo.path, ['stash', 'drop', this.stashRef(index)]),
    );
  }
  async stashShow(id: string, index?: number) {
    try {
      const repo = await this.repoService.get(id);
      const result = await runGit(
        await this.transport(repo),
        repo.path,
        [
          'stash',
          'show',
          '--patch',
          '--include-untracked',
          '--no-ext-diff',
          '--no-textconv',
          this.stashRef(index),
        ],
        undefined,
        { maxOutputBytes: 1024 * 1024, strictUtf8: true },
      );
      if (result.exitCode !== 0) throw new BadRequestException(result.stderr);
      return { diff: result.stdout };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        `无法预览储藏：${error instanceof Error ? error.message : '请刷新后重试。'}`,
      );
    }
  }
  checkout(id: string, files: string[]) {
    return this.write(id, 'discard', async (git, repo, connection) => {
      const paths = this.files(repo, files);
      await assertFileChanges(connection, repo.path, paths);
      return this.checked(git, repo.path, ['checkout', '--', ...paths]);
    });
  }
  ignoreDirectory(id: string, path: string) {
    return this.write(id, 'ignore-directory', (_git, repo, connection) =>
      ignoreDirectory(connection, repo.path, path),
    );
  }
  async previewDiscardChanges(id: string) {
    try {
      const repo = await this.repoService.get(id);
      const connection = await this.transport(
        repo,
        AbortSignal.timeout(60_000),
      );
      return {
        ...(await new DiscardChanges(connection).preview(repo.path)),
        repositoryName: repo.name,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : '无法核验放弃范围。',
        error instanceof DiscardChangesError ? error.statusCode : 502,
      );
    }
  }
  async discardChanges(id: string, token: string, scope: DiscardChangesScope) {
    try {
      validateDiscardChangesRequest(token, scope);
      return await this.write(
        id,
        'discard-all',
        async (_git, repo, connection) => {
          try {
            return await new DiscardChanges(connection).discard(
              repo.path,
              token,
              scope,
            );
          } catch (error) {
            throw new HttpException(
              error instanceof Error
                ? error.message
                : '放弃操作失败，请刷新仓库状态。',
              error instanceof DiscardChangesError ? error.statusCode : 502,
            );
          }
        },
      );
    } catch (error) {
      if (error instanceof DiscardChangesError)
        throw new HttpException(error.message, error.statusCode);
      throw error;
    }
  }
  reset(id: string, mode: 'soft' | 'mixed' | 'hard', commit?: string) {
    return this.write(id, 'reset', (git, repo) => {
      if (!['soft', 'mixed', 'hard'].includes(mode))
        throw new BadRequestException('无效的重置模式。');
      return this.checked(git, repo.path, [
        'reset',
        `--${mode}`,
        ...(commit ? [this.value(commit, '提交')] : []),
      ]);
    });
  }
  cherryPick(id: string, commits: string[]) {
    return this.write(id, 'cherry-pick', (git, repo) => {
      if (!Array.isArray(commits) || !commits.length)
        throw new BadRequestException('请选择提交。');
      return this.checked(git, repo.path, [
        'cherry-pick',
        ...commits.map((commit) => this.value(commit, '提交')),
      ]);
    });
  }
  revert(id: string, commit: string) {
    return this.write(id, 'revert', (git, repo) =>
      this.checked(git, repo.path, [
        'revert',
        '--no-edit',
        this.value(commit, '提交'),
      ]),
    );
  }
  private conflict<T>(
    id: string,
    kind: string,
    operation: (
      conflicts: ConflictResolution,
      repo: Repository,
      connection: RepositoryTransport,
    ) => Promise<T>,
  ) {
    return this.write(id, kind, async (_git, repo, connection) => {
      try {
        return await operation(
          new ConflictResolution(connection),
          repo,
          connection,
        );
      } catch (error) {
        if (error instanceof ConflictResolutionError)
          throw new HttpException(error.message, error.statusCode);
        throw error;
      }
    });
  }
  continueOperation(id: string) {
    return this.controlConflictOperation(id, 'continue');
  }
  skipOperation(id: string) {
    return this.controlConflictOperation(id, 'skip');
  }
  async abortOperation(id: string) {
    await this.controlConflictOperation(id, 'abort');
    return { success: true };
  }
  private controlConflictOperation(
    id: string,
    action: 'continue' | 'skip' | 'abort',
  ) {
    return this.conflict(
      id,
      `conflict-${action}`,
      async (conflicts, repo, connection) => {
        const rebase = new InteractiveRebase(connection);
        if ((await rebase.state(repo.path)).managed) {
          // Keep the prepared messages and session cleanup when the shared
          // conflict controls act on an Alune interactive rebase.
          const result = await rebase.control(repo.path, action);
          if (result.error && !result.state.conflicts.length)
            throw new BadRequestException(result.error);
          return {
            success: true as const,
            conflicts: result.state.conflicts.length > 0,
          };
        }
        if (action === 'abort') {
          await conflicts.abort(repo.path);
          return { success: true as const, conflicts: false };
        }
        return conflicts[action](repo.path);
      },
    );
  }
  resolveConflictFile(id: string, file: string, side: ConflictSide) {
    return this.conflict(id, 'resolve-conflict', async (conflicts, repo) => {
      await conflicts.resolveFile(repo.path, this.files(repo, [file])[0], side);
      return { success: true };
    });
  }
  resolveConflictBlock(
    id: string,
    file: string,
    index: number,
    choice: ConflictBlockChoice,
    expected: string,
  ) {
    return this.conflict(id, 'resolve-conflict', async (conflicts, repo) => {
      await conflicts.resolveBlock(
        repo.path,
        this.files(repo, [file])[0],
        index,
        choice,
        expected,
      );
      return { success: true };
    });
  }
  addRemote(id: string, name: string, url: string) {
    return this.write(id, 'add-remote', (git, repo) =>
      this.checked(git, repo.path, [
        'remote',
        'add',
        this.value(name, '远程名称'),
        this.value(url, '远程地址'),
      ]),
    );
  }
  saveAuthor(id: string, name: string, email: string) {
    return this.write(id, 'author', async (git, repo) => {
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof email !== 'string' ||
        !email.trim() ||
        /[\r\n\0]/.test(name + email)
      )
        throw new BadRequestException('请填写有效的作者姓名和邮箱。');
      await this.checked(git, repo.path, [
        'config',
        '--local',
        'user.name',
        name,
      ]);
      return this.checked(git, repo.path, [
        'config',
        '--local',
        'user.email',
        email,
      ]);
    });
  }
  createWorktree(id: string, path: string, branch: string) {
    return this.write(id, 'create-worktree', async (git, repo) => {
      if (repo.source !== 'local')
        throw new BadRequestException('新建 Worktree 当前仅支持本地仓库。');
      if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
        throw new BadRequestException('请输入新 Worktree 的完整目录路径。');
      const parent = await realpath(dirname(path));
      const target = resolve(parent, basename(path));
      const nested = relative(repo.path, target);
      if (
        !nested ||
        (nested !== '..' &&
          !nested.startsWith('..' + sep) &&
          !isAbsolute(nested))
      )
        throw new BadRequestException('请选择当前仓库之外的新目录。');
      await this.checked(git, repo.path, [
        'worktree',
        'add',
        '-b',
        await this.branch(git, repo.path, branch),
        '--',
        target,
        'HEAD',
      ]);
      return this.repoService.addLocal(target);
    });
  }
  removeWorktree(id: string, path: string, confirmed: boolean) {
    return this.write(id, 'remove-worktree', async (git, repo, connection) => {
      if (repo.source !== 'local' || confirmed !== true)
        throw new BadRequestException('请明确确认删除此本地 Worktree 目录。');
      const worktrees = new GitWorktrees(connection);
      const item = (await worktrees.list(repo.path)).find(
        (item) => item.path === path,
      );
      if (!item || item.isCurrent || item.bare || item.locked || item.prunable)
        throw new BadRequestException(
          '无法删除当前、锁定或已失效的 Worktree。',
        );
      const target = await worktrees.resolve(repo.path, path);
      const status = await git.execute(target, [
        'status',
        '--porcelain=v2',
        '-z',
        '--untracked-files=all',
        '--ignored=matching',
      ]);
      if (status.exitCode !== 0 || status.stdout)
        throw new ConflictException(
          '此 Worktree 存在改动、未跟踪或忽略文件；请先保留需要的内容。',
        );
      const key = (value: string) =>
        process.platform === 'win32'
          ? worktreePathKey(value).toLowerCase()
          : worktreePathKey(value);
      const registrations = (await this.repoService.list()).filter(
        (registered) =>
          registered.source === 'local' && key(registered.path) === key(target),
      );
      const removedIds = registrations.map((registered) => registered.id);
      // Hold the admission lock across the filesystem operation and registry
      // deletion so a new shell cannot start between the check and Git remove.
      return this.repoService.withoutTerminals(removedIds, async () => {
        await this.checked(git, repo.path, [
          'worktree',
          'remove',
          '--',
          target,
        ]);
        for (const registered of registrations)
          await this.repoService.delete(registered.id);
        return { success: true, removedIds };
      });
    });
  }
}
