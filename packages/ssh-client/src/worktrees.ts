import { runGit } from './repository-transport';
import type { RepositoryTransport } from './repository-transport';
import { normalizeRepositoryPath } from './repository-path';
import { promisify } from 'util';
import type { WorktreeInfo } from '@alune/shared';
import { isWindowsPath } from './git-shell';

// Do not trim: whitespace and newlines can be part of a worktree's path.
export function worktreePathKey(path: string): string {
  const value = isWindowsPath(path)
    ? path
        .replace(/\\/g, '/')
        .replace(/^\/?([a-z]):/i, (_, drive: string) => drive.toUpperCase() + ':')
    : path;
  return normalizeRepositoryPath(value).replace(/\/$/, '') || '/';
}

export function parseWorktrees(output: string): WorktreeInfo[] {
  if (output && !output.endsWith('\0\0')) throw new Error('Worktree 列表不完整，请刷新后重试。');
  const result: WorktreeInfo[] = [];
  for (const record of output.split('\0\0').filter(Boolean)) {
    const fields = record.split('\0');
    if (!fields[0].startsWith('worktree ') || fields[0].length === 9)
      throw new Error('无法解析 Worktree 列表。');
    const item: WorktreeInfo = {
      path: fields[0].slice(9),
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
      isCurrent: false,
    };
    for (const field of fields.slice(1)) {
      if (field.startsWith('HEAD ')) item.head = field.slice(5);
      else if (field.startsWith('branch '))
        item.branch = field.slice(7).replace(/^refs\/heads\//, '');
      else if (field === 'detached') item.detached = true;
      else if (field === 'bare') item.bare = true;
      else if (field === 'locked' || field.startsWith('locked ')) {
        item.locked = true;
        item.lockedReason = field.slice(7) || undefined;
      } else if (field === 'prunable' || field.startsWith('prunable ')) {
        item.prunable = true;
        item.prunableReason = field.slice(9) || undefined;
      }
    }
    result.push(item);
  }
  return result;
}

export class GitWorktrees {
  constructor(private connection: RepositoryTransport) {}

  private async read(path: string, args: string[], signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const result = await runGit(this.connection, path, args, signal, {
      maxOutputBytes: 1024 * 1024,
      strictUtf8: true,
    });
    signal?.throwIfAborted();
    if (result.exitCode !== 0)
      throw new Error(
        '无法读取 Worktree：' + (result.stderr || '目录不存在、不可访问或不是 Git 仓库。'),
      );
    return result.stdout;
  }

  async canonicalPath(path: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    let canonical: string;
    try {
      canonical = await this.connection.withSftp((sftp) =>
        promisify(sftp.realpath.bind(sftp))(path),
      );
    } catch (error) {
      signal?.throwIfAborted();
      const code = (error as { code?: number | string })?.code;
      if (code === 2 || code === 'ENOENT') throw new Error('目录不存在或已移走，请刷新列表。');
      if (code === 3 || code === 'EACCES') throw new Error('没有读取此目录的权限。');
      throw error;
    }
    signal?.throwIfAborted();
    // Windows OpenSSH may report /C:/...; native Git expects C:/... . Keep
    // literal POSIX backslashes and UNC paths intact.
    return canonical.replace(/^\/([a-z]:[\\/])/i, '$1');
  }

  private async root(path: string, signal?: AbortSignal): Promise<string> {
    const bare = await this.read(path, ['rev-parse', '--is-bare-repository'], signal);
    const root =
      bare.trim() === 'true'
        ? path
        : (await this.read(path, ['rev-parse', '--show-toplevel'], signal)).replace(/\r?\n$/, '');
    return this.canonicalPath(root, signal);
  }

  async list(path: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
    const output = await this.read(path, ['worktree', 'list', '--porcelain', '-z'], signal);
    const current = worktreePathKey(await this.root(path, signal));
    const items = parseWorktrees(output);
    const direct = items.find((item) => worktreePathKey(item.path) === current);
    if (direct) {
      direct.isCurrent = true;
      return items;
    }
    // Git resolves the containing working tree even if registration uses a subdirectory.
    for (const item of items) {
      item.isCurrent = worktreePathKey(item.path) === current;
      if (!item.isCurrent && !item.prunable) {
        try {
          item.isCurrent = worktreePathKey(await this.canonicalPath(item.path, signal)) === current;
          if (item.isCurrent) break;
        } catch {
          signal?.throwIfAborted();
          // A missing sibling remains visible; opening it will give an actionable error.
        }
      }
    }
    return items;
  }

  async resolve(path: string, selectedPath: string, signal?: AbortSignal): Promise<string> {
    const items = await this.list(path, signal);
    const item = items.find((entry) => entry.path === selectedPath);
    if (!item) throw new Error('此目录已不在仓库的 Worktree 列表中，请刷新后重试。');
    if (item.bare) throw new Error('裸仓库没有可打开的工作目录。');
    const target = await this.canonicalPath(item.path, signal);
    if (worktreePathKey(await this.root(target, signal)) !== worktreePathKey(target))
      throw new Error('Worktree 目录已失效，请刷新列表后重试。');
    const common = async (directory: string) =>
      this.canonicalPath(
        (
          await this.read(
            directory,
            ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            signal,
          )
        ).replace(/\r?\n$/, ''),
        signal,
      );
    if (worktreePathKey(await common(path)) !== worktreePathKey(await common(target)))
      throw new Error('此目录已不属于当前仓库，请刷新 Worktree 列表。');
    return target;
  }
}
