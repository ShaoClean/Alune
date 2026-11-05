import {
  Injectable,
  HttpException,
  ConflictException,
  BadRequestException,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import { ProxyService } from '../proxy/proxy.service';
import { errorContext, logger, type LogContext } from '../logging/logger';
import {
  WorkspaceFileActions,
  RepositoryFileError,
  GitCommands,
  GitSigning,
  GitTags,
  LocalConnection,
  NewFileDeletion,
  NewFileDeletionError,
  validateNewFilePath,
  DiscardChanges,
  DiscardChangesError,
  runGit,
  InteractiveRebase,
} from '@alune/ssh-client';
import { GitActions } from '@alune/agent/git/actions';
import type { RepositoryTransport } from '@alune/agent/git/repository-transport';
import type { Repository } from '@alune/shared';

type Operation = {
  controller: AbortController;
  kind: string;
  startedAt: number;
  progress?: string;
};
@Injectable()
export class GitService extends GitActions implements OnModuleDestroy {
  private readonly active = new Map<string, Operation>();
  onModuleDestroy() {
    for (const operation of this.active.values())
      operation.controller.abort(new Error('Alune 正在关闭，Git 操作已取消。'));
  }
  constructor(
    private connectionService: ConnectionService,
    private repoService: RepositoryService,
    @Optional() private proxy?: ProxyService,
  ) {
    super(repoService, {
      invalid: BadRequestException,
      conflict: ConflictException,
      status: HttpException,
    });
  }

  private async transport(
    repo: Repository,
    signal?: AbortSignal,
  ): Promise<RepositoryTransport> {
    if (repo.source === 'local')
      return new LocalConnection(
        signal,
        this.proxy ? () => this.proxy!.settings.snapshot() : undefined,
      );
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

  protected async write<T>(
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
      () =>
        controller.abort(
          new Error(
            'Git 操作超时，请检查仓库状态后重试。' +
              (['commit', 'create-tag'].includes(kind)
                ? ' 若启用了签名，请检查执行主机的 pinentry 或 agent 是否正在等待交互。'
                : ''),
          ),
        ),
      5 * 60_000,
    );
    timer.unref();
    let release: (() => void) | undefined;
    const started = performance.now();
    const context: LogContext = { repositoryId: id, operation: kind };
    logger.debug('git', `Git 操作开始：${kind}`, context);
    try {
      const repo = await this.repoService.get(id);
      Object.assign(context, {
        repository: repo.name,
        location: repo.source || 'ssh',
      });
      const transport = await this.transport(repo, controller.signal);
      let progressTail = '';
      const recordProgress = (chunk: string) => {
        progressTail = (progressTail + chunk).slice(-4096);
        const lines = progressTail.split(/[\r\n]/).filter(Boolean);
        const line = lines
          .reverse()
          .find((value) =>
            /(?:LFS|Uploading|Downloading|Smudge|batch response)/i.test(value),
          );
        const active = this.active.get(id);
        if (line && active?.controller === controller)
          active.progress = line
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .slice(0, 400);
      };
      const connection: RepositoryTransport = {
        signal: controller.signal,
        execCommand: transport.execCommand.bind(transport),
        withSftp: transport.withSftp.bind(transport),
        hasAnyPath: transport.hasAnyPath?.bind(transport),
        execGit: (path, args, signal, options) =>
          this.traceGit(
            args,
            runGit(transport, path, args, signal, {
              ...options,
              environment: {
                ...options?.environment,
                ...(['push', 'pull'].includes(kind)
                  ? { GIT_LFS_FORCE_PROGRESS: '1' }
                  : {}),
              },
              onStdout: (chunk) => {
                options?.onStdout?.(chunk);
                recordProgress(chunk);
              },
              onStderr: (chunk) => {
                options?.onStderr?.(chunk);
                recordProgress(chunk);
              },
            }),
          ),
      };
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
      const result = await operation(
        new GitCommands(connection),
        repo,
        connection,
      );
      logger.info('git', `Git 操作完成：${kind}`, {
        ...context,
        durationMs: Math.round(performance.now() - started),
      });
      return result;
    } catch (error) {
      const failure = {
        ...context,
        durationMs: Math.round(performance.now() - started),
        ...errorContext(error),
      };
      // Cancellations and request validation are expected; real Git failures are errors.
      if (
        controller.signal.aborted ||
        (error instanceof HttpException && error.getStatus() < 500)
      )
        logger.warn('git', `Git 操作未完成：${kind}`, failure);
      else logger.error('git', `Git 操作失败：${kind}`, failure);
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

  private traceGit<T extends { exitCode: number | null }>(
    args: string[],
    running: Promise<T>,
  ): Promise<T> {
    if (!logger.enabled('DEBUG')) return running;
    const started = performance.now();
    // Subcommand and option names only: other arguments can carry messages,
    // paths or URLs, and option values are dropped for the same reason.
    const command = [
      args[0],
      ...args
        .slice(1, 6)
        .map((arg) => arg.split('=')[0])
        .filter((arg) => /^--?[A-Za-z][\w-]{0,40}$/.test(arg)),
    ].join(' ');
    return running.then(
      (result) => {
        logger.debug('git', `git ${command}`, {
          exitCode: result.exitCode,
          durationMs: Math.round(performance.now() - started),
        });
        return result;
      },
      (error) => {
        logger.debug('git', `git ${command}`, {
          durationMs: Math.round(performance.now() - started),
          ...errorContext(error),
        });
        throw error;
      },
    );
  }

  operation(id: string) {
    const active = this.active.get(id);
    return active
      ? {
          kind: active.kind,
          startedAt: active.startedAt,
          progress: active.progress,
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

  rebaseConflict(id: string, path: string) {
    return this.readRebase(id, (rebase, root) => rebase.conflict(root, path));
  }

  async deleteNewFile(
    id: string,
    path: string,
    token?: string,
    preview = false,
  ) {
    if (!preview) return this.removeNewFile(id, path, token);
    try {
      validateNewFilePath(path);
      const repo = await this.repoService.get(id);
      return await new NewFileDeletion(await this.transport(repo)).preview(
        repo.path,
        path,
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
  async signingConfig(id: string) {
    const repo = await this.repoService.get(id);
    try {
      return {
        ...(await new GitSigning(await this.transport(repo)).read(repo.path)),
        source: repo.source,
      };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
  async commitSignatures(id: string, hashes: string[]) {
    const repo = await this.repoService.get(id);
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error('签名验证超时，请检查执行主机的签名程序后重试。'),
        ),
      35_000,
    );
    try {
      return await new GitSigning(
        await this.transport(repo, controller.signal),
      ).signatures(repo.path, hashes);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
