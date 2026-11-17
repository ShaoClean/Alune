import { isAbsolute, relative, resolve, dirname, basename, sep } from 'node:path';
import { promisify } from 'node:util';
import { GitCommands } from './git-commands-writes';
import { GitSubmodules } from './submodules-writes';
import { StaleWorkspaceFilePreview, WorkspaceFileActions } from './workspace-file-actions';
import { RepositoryFileError, validateRepositoryPath } from './repository-files';
import { GitSigning } from './git-signing-writes';
import { PartialChanges, PartialChangesError } from './partial-changes-writes';
import { GitTags } from './git-tags-writes';
import { NewFileDeletion, NewFileDeletionError, validateNewFilePath } from './new-file-deletion';
import {
  DiscardChanges,
  DiscardChangesError,
  validateDiscardChangesRequest,
} from './discard-changes';
import { GitWorktrees, worktreePathKey } from './worktrees';
import { assertFileChanges, ignoreDirectory } from './change-entries-writes';
import { InteractiveRebase } from './interactive-rebase';
import { ConflictResolution, ConflictResolutionError } from './conflict-resolution-writes';
import type { RepositoryTransport } from './repository-transport';
import type {
  SigningConfig,
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
} from '@alune/domain';

function promisifyRealpath(connection: RepositoryTransport, path: string) {
  return connection.withSftp((files) => promisify(files.realpath.bind(files))(path));
}
export interface WriteCatalog {
  addLocal(path: string): Promise<Repository>;
  list(): Promise<Repository[]>;
  delete(id: string): Promise<unknown>;
  withoutTerminals<T>(ids: string[], operation: () => Promise<T>): Promise<T>;
}
export type GitAction<T> = (
  git: GitCommands,
  repo: Repository,
  connection: RepositoryTransport,
) => Promise<T>;
export abstract class GitActions {
  constructor(
    protected readonly registry: WriteCatalog,
    protected readonly errors: {
      invalid: new (message: string) => Error;
      conflict: new (message: string | BranchNameConflict) => Error;
      staleWorkspacePreview?: new (message: string) => Error;
      status: new (message: string, status: number) => Error;
    },
  ) {}
  protected abstract write<T>(id: string, kind: string, operation: GitAction<T>): Promise<T>;

  protected value(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.startsWith('-'))
      throw new this.errors.invalid(`无效的${label}。`);
    return value;
  }

  private files(repo: Repository, files: string[]) {
    if (!Array.isArray(files) || !files.length) throw new this.errors.invalid('请选择文件。');
    files.forEach((file) => validateRepositoryPath(repo.path, file));
    return files;
  }

  protected stashRef(index: number = 0) {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new this.errors.invalid('无效的储藏编号。');
    return `stash@{${index}}`;
  }

  private async checked(git: GitCommands, path: string, args: string[]) {
    const result = await git.execute(path, args);
    if (result.exitCode !== 0)
      throw new Error(result.stderr || result.stdout || 'Git 操作未完成，请刷新状态后重试。');
    return { success: true, stdout: result.stdout };
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

  async removeNewFile(id: string, path: string, token?: string) {
    try {
      validateNewFilePath(path);
      return await this.write(id, 'delete-file', async (_git, repo, connection) => {
        try {
          return await new NewFileDeletion(connection).delete(repo.path, path, token!);
        } catch (error) {
          if (error instanceof NewFileDeletionError)
            throw new this.errors.status(error.message, error.statusCode);
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof NewFileDeletionError)
        throw new this.errors.status(error.message, error.statusCode);
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
        if (error instanceof StaleWorkspaceFilePreview)
          throw new (this.errors.staleWorkspacePreview ?? this.errors.conflict)(error.message);
        if (error instanceof RepositoryFileError)
          throw new this.errors.status(error.message, error.statusCode);
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
            throw new this.errors.status(error.message, error.statusCode);
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

  commit(id: string, message: string, description?: string, amend?: string) {
    return this.write(id, 'commit', async (git, repo) => {
      if (
        typeof message !== 'string' ||
        !message.trim() ||
        (description !== undefined && typeof description !== 'string') ||
        (amend !== undefined &&
          (typeof amend !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(amend)))
      )
        throw new this.errors.invalid('请填写有效的提交信息。');
      const result = await git.commit(
        repo.path,
        description ? `${message}\n\n${description}` : message,
        amend,
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
      return { success: true, stdout: result.stdout };
    });
  }

  updateSubmodules(id: string, action: 'update' | 'sync') {
    return this.write(id, 'submodule-' + action, (_git, repo, connection) =>
      new GitSubmodules(connection).update(repo.path, action),
    );
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
          throw new this.errors.invalid('无效的推送选项。');
      if (setUpstream && (!remote || !branch))
        throw new this.errors.invalid('请选择远程与上游分支。');
      if (branch && !remote) throw new this.errors.invalid('请选择推送的远程。');
      let ref = branch === undefined ? undefined : await this.branch(git, repo.path, branch);
      if (setUpstream) {
        const current = await git.execute(repo.path, ['symbolic-ref', '--quiet', 'HEAD']);
        const head = await git.execute(repo.path, ['rev-parse', '--verify', 'HEAD']);
        if (current.exitCode !== 0 || head.exitCode !== 0)
          throw new this.errors.invalid('请先切换到本地分支并创建提交，再设置上游。');
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
      this.checked(git, repo.path, ['fetch', ...(remote ? [this.value(remote, '远程名称')] : [])]),
    );
  }

  deepen(id: string, remote: string = 'origin') {
    return this.write(id, 'fetch-history', (git, repo) =>
      this.checked(git, repo.path, ['fetch', '--unshallow', this.value(remote, '远程名称')]),
    );
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
      if (options.isRemote !== undefined && typeof options.isRemote !== 'boolean')
        throw new this.errors.invalid('无效的分支类型。');
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
      const remoteSelected = options.isRemote ?? (!local && /^(refs\/)?remotes\//.test(name));
      const switchLocal = async (branch: string): Promise<SwitchBranchResult> => {
        const result = await this.checked(git, repo.path, ['switch', '--no-guess', '--', branch]);
        return { success: true, branch, stdout: result.stdout };
      };
      if (!remoteSelected) {
        if (options.localName !== undefined)
          throw new this.errors.invalid('只有远程分支可指定新的本地分支名称。');
        if (!local) throw new this.errors.invalid(`本地分支“${name}”已不存在，请刷新分支列表。`);
        return switchLocal(name);
      }
      if (!/^(refs\/)?remotes\//.test(name))
        throw new this.errors.invalid('请选择完整的远程分支引用。');
      const remoteRef = name.startsWith('refs/') ? name : `refs/${name}`;
      await this.checked(git, repo.path, ['check-ref-format', remoteRef]);
      const refs = await this.checked(git, repo.path, [
        'for-each-ref',
        '--format=%(refname)%00%(symref)',
        remoteRef,
      ]);
      if (!refs.stdout.split('\n').includes(`${remoteRef}\0`))
        throw new this.errors.invalid(`远程分支“${name}”已失效或不是分支，请先获取并刷新列表。`);
      // A remote name may itself contain slashes; use the configured names.
      const remotes = await this.checked(git, repo.path, ['remote']);
      const remote = remotes.stdout
        .split('\n')
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => remoteRef.startsWith(`refs/remotes/${candidate}/`));
      if (!remote)
        throw new this.errors.invalid(`远程分支“${name}”没有对应的远程配置，请刷新列表。`);
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
      await this.checked(git, repo.path, ['check-ref-format', `refs/heads/${targetName}`]);
      const conflict = locals.find((branch) => branch.name === targetName);
      if (conflict) {
        if (conflict.upstream === remoteRef) return switchLocal(conflict.name);
        throw new this.errors.conflict({
          code: 'LOCAL_BRANCH_EXISTS',
          message: `本地分支“${targetName}”已存在，但未跟踪所选远程分支。`,
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
      this.checked(git, repo.path, ['merge', '--no-edit', this.value(branch, '分支名称')]),
    );
  }

  rebase(id: string, branch: string) {
    return this.write(id, 'rebase', (git, repo) =>
      this.checked(git, repo.path, ['rebase', this.value(branch, '分支名称')]),
    );
  }

  stash(id: string, message?: string, includeUntracked?: boolean) {
    return this.write(id, 'stash', (git, repo) => {
      if (includeUntracked !== undefined && typeof includeUntracked !== 'boolean')
        throw new this.errors.invalid('无效的未跟踪文件选项。');
      if (message !== undefined && (typeof message !== 'string' || message.includes('\0')))
        throw new this.errors.invalid('无效的储藏说明。');
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

  async discardChanges(id: string, token: string, scope: DiscardChangesScope) {
    try {
      validateDiscardChangesRequest(token, scope);
      return await this.write(id, 'discard-all', async (_git, repo, connection) => {
        try {
          return await new DiscardChanges(connection).discard(repo.path, token, scope);
        } catch (error) {
          throw new this.errors.status(
            error instanceof Error ? error.message : '放弃操作失败，请刷新仓库状态。',
            error instanceof DiscardChangesError ? error.statusCode : 502,
          );
        }
      });
    } catch (error) {
      if (error instanceof DiscardChangesError)
        throw new this.errors.status(error.message, error.statusCode);
      throw error;
    }
  }

  reset(id: string, mode: 'soft' | 'mixed' | 'hard', commit?: string) {
    return this.write(id, 'reset', (git, repo) => {
      if (!['soft', 'mixed', 'hard'].includes(mode))
        throw new this.errors.invalid('无效的重置模式。');
      return this.checked(git, repo.path, [
        'reset',
        `--${mode}`,
        ...(commit ? [this.value(commit, '提交')] : []),
      ]);
    });
  }

  cherryPick(id: string, commits: string[]) {
    return this.write(id, 'cherry-pick', (git, repo) => {
      if (!Array.isArray(commits) || !commits.length) throw new this.errors.invalid('请选择提交。');
      return this.checked(git, repo.path, [
        'cherry-pick',
        ...commits.map((commit) => this.value(commit, '提交')),
      ]);
    });
  }

  revert(id: string, commit: string) {
    return this.write(id, 'revert', (git, repo) =>
      this.checked(git, repo.path, ['revert', '--no-edit', this.value(commit, '提交')]),
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
        return await operation(new ConflictResolution(connection), repo, connection);
      } catch (error) {
        if (error instanceof ConflictResolutionError)
          throw new this.errors.status(error.message, error.statusCode);
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

  private controlConflictOperation(id: string, action: 'continue' | 'skip' | 'abort') {
    return this.conflict(id, `conflict-${action}`, async (conflicts, repo, connection) => {
      const rebase = new InteractiveRebase(connection);
      if ((await rebase.state(repo.path)).managed) {
        // Keep the prepared messages and session cleanup when the shared
        // conflict controls act on an Alune interactive rebase.
        const result = await rebase.control(repo.path, action);
        if (result.error && !result.state.conflicts.length)
          throw new this.errors.invalid(result.error);
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
    });
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
      await conflicts.resolveBlock(repo.path, this.files(repo, [file])[0], index, choice, expected);
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

  saveSigningConfig(id: string, value: SigningConfig) {
    return this.write(id, 'signing-config', async (_git, repo, connection) => ({
      ...(await new GitSigning(connection).save(repo.path, value)),
      source: repo.source,
    }));
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
        throw new this.errors.invalid('请填写有效的作者姓名和邮箱。');
      await this.checked(git, repo.path, ['config', '--local', 'user.name', name]);
      return this.checked(git, repo.path, ['config', '--local', 'user.email', email]);
    });
  }

  createWorktree(id: string, path: string, branch: string) {
    return this.write(id, 'create-worktree', async (git, repo, connection) => {
      if (repo.source !== 'local')
        throw new this.errors.invalid('新建 Worktree 当前仅支持本地仓库。');
      if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
        throw new this.errors.invalid('请输入新 Worktree 的完整目录路径。');
      const parent = await promisifyRealpath(connection, dirname(path));
      const target = resolve(parent, basename(path));
      const nested = relative(repo.path, target);
      if (!nested || (nested !== '..' && !nested.startsWith('..' + sep) && !isAbsolute(nested)))
        throw new this.errors.invalid('请选择当前仓库之外的新目录。');
      await this.checked(git, repo.path, [
        'worktree',
        'add',
        '-b',
        await this.branch(git, repo.path, branch),
        '--',
        target,
        'HEAD',
      ]);
      return this.registry.addLocal(target);
    });
  }

  removeWorktree(id: string, path: string, confirmed: boolean) {
    return this.write(id, 'remove-worktree', async (git, repo, connection) => {
      if (repo.source !== 'local' || confirmed !== true)
        throw new this.errors.invalid('请明确确认删除此本地 Worktree 目录。');
      const worktrees = new GitWorktrees(connection);
      const item = (await worktrees.list(repo.path)).find((item) => item.path === path);
      if (!item || item.isCurrent || item.bare || item.locked || item.prunable)
        throw new this.errors.invalid('无法删除当前、锁定或已失效的 Worktree。');
      const target = await worktrees.resolve(repo.path, path);
      const status = await git.execute(target, [
        'status',
        '--porcelain=v2',
        '-z',
        '--untracked-files=all',
        '--ignored=matching',
      ]);
      if (status.exitCode !== 0 || status.stdout)
        throw new this.errors.conflict(
          '此 Worktree 存在改动、未跟踪或忽略文件；请先保留需要的内容。',
        );
      const key = (value: string) =>
        process.platform === 'win32'
          ? worktreePathKey(value).toLowerCase()
          : worktreePathKey(value);
      const registrations = (await this.registry.list()).filter(
        (registered) => registered.source === 'local' && key(registered.path) === key(target),
      );
      const removedIds = registrations.map((registered) => registered.id);
      // Hold the admission lock across the filesystem operation and registry
      // deletion so a new shell cannot start between the check and Git remove.
      return this.registry.withoutTerminals(removedIds, async () => {
        await this.checked(git, repo.path, ['worktree', 'remove', '--', target]);
        for (const registered of registrations) await this.registry.delete(registered.id);
        return { success: true, removedIds };
      });
    });
  }
}
