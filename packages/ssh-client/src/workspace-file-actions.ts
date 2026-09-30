import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import type { SFTPWrapper } from 'ssh2';
import type { WorkspaceFilePreview } from '@alune/shared';
import type { RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';
import { joinRepositoryPath } from './repository-path';
import { RepositoryFileError, validateRepositoryPath } from './repository-files';
import { isWindowsPath } from './git-shell';
import { readSftpChunks } from './sftp-file';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing = (error: any) => error?.code === 2 || error?.code === 'ENOENT';
const fail = (message: string) => new RepositoryFileError(message, 409);

export function validateWorkspaceName(root: string, name: string) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.includes('/') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..' ||
    name.toLowerCase() === '.git'
  )
    throw new RepositoryFileError('请输入有效的单个文件名，不能包含路径分隔符或使用 .git。');
  if (
    isWindowsPath(root) &&
    (/[<>:"\\|?*\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
  )
    throw new RepositoryFileError('此名称包含 Windows 不允许的字符或保留名称。');
}

export class WorkspaceFileActions {
  constructor(private readonly connection: RepositoryTransport) {}

  private async git(root: string, args: string[]) {
    const result = await runGit(this.connection, root, args, AbortSignal.timeout(15_000));
    if (result.exitCode) throw new Error(result.stderr.trim() || '无法核验 Git 状态');
    return result.stdout;
  }

  private async parent(sftp: SFTPWrapper, repo: string, path: string) {
    validateRepositoryPath(repo, path);
    const root = await promisify(sftp.realpath.bind(sftp))(repo);
    let parent = root;
    for (const part of path.split('/').slice(0, -1)) {
      parent = joinRepositoryPath(parent, part);
      const stat = await promisify(sftp.lstat.bind(sftp))(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw fail('父目录包含符号链接或不是目录，无法安全操作。');
      const nested = await promisify(sftp.lstat.bind(sftp))(
        joinRepositoryPath(parent, '.git'),
      ).then(
        () => true,
        (error) => {
          if (missing(error)) return false;
          throw error;
        },
      );
      if (nested) throw fail('目标位于嵌套仓库或 Worktree 内，请打开对应仓库后操作。');
    }
    const actual = await promisify(sftp.realpath.bind(sftp))(parent);
    const same = isWindowsPath(root)
      ? actual.toLowerCase() === parent.toLowerCase()
      : actual === parent;
    if (!same) throw fail('父目录发生变化或包含符号链接，无法安全操作。');
    return { root, target: joinRepositoryPath(root, path) };
  }

  private async inspect(repo: string, path: string): Promise<WorkspaceFilePreview> {
    validateRepositoryPath(repo, path);
    if ((await this.git(repo, ['rev-parse', '--show-prefix'])).trim())
      throw fail('请从仓库根目录操作文件。');
    const parents = path
      .split('/')
      .slice(0, -1)
      .map((_part, i, parts) => parts.slice(0, i + 1).join('/'));
    if (parents.length) {
      const entries = await this.git(repo, ['ls-files', '--stage', '-z', '--', ...parents]);
      if (
        entries
          .split('\0')
          .some(
            (entry) =>
              entry.startsWith('160000 ') && parents.includes(entry.slice(entry.indexOf('\t') + 1)),
          )
      )
        throw fail('目标位于子模块内，请打开对应仓库后操作。');
    }
    const index = await this.git(repo, ['ls-files', '--stage', '-z', '--', path]);
    const staged = !!(await this.git(repo, ['diff', '--cached', '--name-only', '-z', '--', path]));
    return this.connection.withSftp(async (sftp) => {
      const { root, target } = await this.parent(sftp, repo, path);
      let stat;
      try {
        stat = await promisify(sftp.lstat.bind(sftp))(target);
      } catch (error) {
        if (!missing(error)) throw error;
        return {
          path,
          absolutePath: target,
          staged,
          canModify: false,
          reason: '工作区文件已不存在。',
          token: '',
        };
      }
      if ((!stat.isFile() && !stat.isSymbolicLink()) || index.startsWith('160000 '))
        return {
          path,
          absolutePath: target,
          staged,
          canModify: false,
          reason: '仅支持单个普通文件或符号链接，不支持目录、子模块和特殊文件。',
          token: '',
        };
      const content = createHash('sha256');
      if (stat.isSymbolicLink()) content.update(await promisify(sftp.readlink.bind(sftp))(target));
      else
        for await (const chunk of readSftpChunks(sftp, target)) {
          this.connection.signal?.throwIfAborted();
          content.update(chunk);
        }
      const attrs = (s: typeof stat) => [s.mode, s.size, s.mtime, s.uid, s.gid];
      const after = await promisify(sftp.lstat.bind(sftp))(target);
      if (hash(attrs(stat)) !== hash(attrs(after)))
        throw fail('文件在读取期间发生变化，请重新确认。');
      return {
        path,
        absolutePath: target,
        staged,
        canModify: true,
        token: hash([root, path, index, staged, attrs(after), content.digest('hex')]),
      };
    });
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RepositoryFileError) throw error;
      const code = (error as any)?.code;
      const message = missing(error)
        ? '文件或父目录已消失，请刷新。'
        : code === 3 || code === 'EACCES' || code === 'EPERM'
          ? `没有修改此文件的权限：${error instanceof Error ? error.message : '权限被拒绝'}`
          : error instanceof Error
            ? error.message
            : '连接或文件操作失败';
      throw new RepositoryFileError(
        `操作未完成：${message}。请刷新并核对文件状态；暂存内容未被此操作修改。`,
        502,
      );
    }
  }

  preview(repo: string, path: string) {
    return this.guard(() => this.inspect(repo, path));
  }

  mutate(repo: string, path: string, token: string, action: 'delete' | 'rename', name?: string) {
    return this.guard(async () => {
      if (action !== 'delete' && action !== 'rename')
        throw new RepositoryFileError('未知文件操作。');
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
        throw fail('请先核验文件并确认。');
      if (action === 'rename') validateWorkspaceName(repo, name!);
      const snapshot = await this.inspect(repo, path);
      if (!snapshot.canModify || snapshot.token !== token)
        throw fail('文件、暂存内容或路径已变化，请重新读取并确认。');
      const next =
        action === 'rename'
          ? posix.dirname(path) === '.'
            ? name!
            : `${posix.dirname(path)}/${name}`
          : undefined;
      if (next === path) throw fail('新名称与当前名称相同。');
      await this.connection.withSftp(async (sftp) => {
        const { target } = await this.parent(sftp, repo, path);
        this.connection.signal?.throwIfAborted();
        if (!next) {
          await promisify(sftp.unlink.bind(sftp))(target);
          const exists = await promisify(sftp.lstat.bind(sftp))(target).then(
            () => true,
            (error) => {
              if (missing(error)) return false;
              throw error;
            },
          );
          if (exists) throw fail('删除后文件被重新创建，请刷新核对。');
          return;
        }
        const destination = (await this.parent(sftp, repo, next)).target;
        const lstat = promisify(sftp.lstat.bind(sftp));
        const exists = await lstat(destination).then(
          () => true,
          (error) => {
            if (missing(error)) return false;
            throw error;
          },
        );
        // SFTP v3 rename must refuse an existing destination. LocalConnection
        // implements the same contract with link/unlink, never fs.rename.
        const rename = promisify(sftp.rename.bind(sftp));
        if (exists) {
          const entries = await promisify(sftp.readdir.bind(sftp))(posix.dirname(target));
          const caseOnly =
            path.toLowerCase() === next.toLowerCase() &&
            entries.some((entry) => entry.filename === posix.basename(path)) &&
            !entries.some((entry) => entry.filename === name);
          if (!caseOnly) throw fail('同名文件已存在，未覆盖任何文件。');
          const temporary = joinRepositoryPath(
            posix.dirname(target),
            `.alune-rename-${randomUUID()}`,
          );
          await rename(target, temporary);
          try {
            await this.parent(sftp, repo, path);
            await rename(temporary, destination);
          } catch (error) {
            try {
              await this.parent(sftp, repo, path);
              await rename(temporary, target);
            } catch {
              throw fail(`重命名中断且无法恢复原名称，文件保留在 ${temporary}，请核对后恢复。`);
            }
            throw error;
          }
        } else await rename(target, destination);
        await lstat(destination);
        const entries = await promisify(sftp.readdir.bind(sftp))(posix.dirname(target));
        if (
          !entries.some((entry) => entry.filename === name) ||
          entries.some((entry) => entry.filename === posix.basename(path))
        )
          throw fail('无法确认重命名结果，请刷新核对。');
      });
      return { success: true as const, path, newPath: next };
    });
  }
}
