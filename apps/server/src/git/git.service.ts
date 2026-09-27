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
  GitCommands,
  LocalConnection,
  NewFileDeletion,
  NewFileDeletionError,
  validateNewFilePath,
  validateRepositoryPath,
  GitWorktrees,
  worktreePathKey,
  runGit,
} from '@alune/ssh-client';
import type { RepositoryTransport } from '@alune/ssh-client';
import type { Repository } from '@alune/shared';

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
    const connection = await (
      signal ? Promise.race([connecting, cancelled]) : connecting
    ).finally(() => {
      if (abort) signal?.removeEventListener('abort', abort);
    });
    signal?.throwIfAborted();
    return {
      signal,
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
    try {
      const repo = await this.repoService.get(id);
      const connection = await this.transport(repo, controller.signal);
      controller.signal.throwIfAborted();
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
  createBranch(id: string, name: string, checkout?: boolean) {
    return this.write(id, 'create-branch', async (git, repo) =>
      this.checked(git, repo.path, [
        ...(checkout ? ['checkout', '-b'] : ['branch']),
        await this.branch(git, repo.path, name),
      ]),
    );
  }
  switchBranch(id: string, name: string) {
    return this.write(id, 'switch-branch', async (git, repo) => {
      this.value(name, '分支名称');
      const local = await git.execute(repo.path, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${name}`,
      ]);
      return this.checked(git, repo.path, [
        'switch',
        ...(local.exitCode !== 0 && /^(refs\/)?remotes\//.test(name)
          ? ['--detach']
          : []),
        '--',
        name,
      ]);
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
    return this.write(id, 'discard', (git, repo) =>
      this.checked(git, repo.path, [
        'checkout',
        '--',
        ...this.files(repo, files),
      ]),
    );
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
      await this.checked(git, repo.path, ['worktree', 'remove', '--', target]);
      const removedIds: string[] = [];
      for (const registered of await this.repoService.list()) {
        if (
          registered.source === 'local' &&
          (process.platform === 'win32'
            ? worktreePathKey(registered.path).toLowerCase() ===
              worktreePathKey(target).toLowerCase()
            : worktreePathKey(registered.path) === worktreePathKey(target))
        ) {
          await this.repoService.delete(registered.id);
          removedIds.push(registered.id);
        }
      }
      return { success: true, removedIds };
    });
  }
}
