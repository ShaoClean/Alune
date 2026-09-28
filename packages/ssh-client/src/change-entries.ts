import { promisify } from 'node:util';
import { posix } from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import type { FileStatus } from '@alune/shared';
import { runGit, type RepositoryTransport } from './repository-transport';
import { joinRepositoryPath } from './repository-path';
import { validateRepositoryPath } from './repository-files';
import { parseStatus, type StatusRecord } from './git-status';
import { parseWorktrees, worktreePathKey } from './worktrees';
import { isWindowsPath } from './git-shell';

const missing = (error: any) =>
  error?.code === 2 || error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
async function stat(sftp: SFTPWrapper, path: string) {
  try {
    return await promisify(sftp.lstat.bind(sftp))(path);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

export function specialChangeReason(record: StatusRecord): string | undefined {
  const fields = record.raw.split(' ');
  if (record.path.endsWith('/')) return '目录或嵌套仓库，请在对应仓库中处理';
  if (record.kind !== '?' && (fields[2] !== 'N...' || fields.slice(3, 6).includes('160000')))
    return '子模块，请在对应仓库中处理';
}

export async function classifyChanges(
  connection: RepositoryTransport,
  repoPath: string,
  files: FileStatus[],
  signal?: AbortSignal,
): Promise<void> {
  const candidates = files.filter((file) => file.kind || file.status === 'deleted');
  if (!candidates.length) return;
  const directories: FileStatus[] = [];
  await connection.withSftp(async (sftp) => {
    const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
    for (const file of candidates) {
      signal?.throwIfAborted();
      const path = file.path.replace(/\/$/, '');
      validateRepositoryPath(repoPath, path);
      const target = joinRepositoryPath(root, path);
      const disk = await stat(sftp, target);
      if (!disk?.isDirectory()) continue;
      const git = await stat(sftp, joinRepositoryPath(target, '.git'));
      if (file.kind !== 'submodule') file.kind = git ? 'repository' : 'directory';
      if (git) {
        file.repositoryPath = target.replace(/^\/([a-z]:\/)/i, '$1');
        if (file.kind === 'repository') directories.push(file);
      }
    }
  });
  if (!directories.length) return;
  const listed = await runGit(
    connection,
    repoPath,
    ['worktree', 'list', '--porcelain', '-z'],
    signal,
  );
  if (listed.exitCode !== 0) throw new Error(`无法识别 Worktree：${listed.stderr}`);
  const key = (path: string) =>
    isWindowsPath(repoPath) ? worktreePathKey(path).toLowerCase() : worktreePathKey(path);
  const worktrees = new Map(
    parseWorktrees(listed.stdout).map((item) => [key(item.path), item.path]),
  );
  for (const file of directories) {
    const worktree = worktrees.get(key(file.repositoryPath!));
    if (worktree) {
      file.kind = 'worktree';
      file.repositoryPath = worktree;
    }
  }
}

// Validate the actual targets, not just their spelling: stripping a trailing
// slash must never turn an embedded repository into a newly staged gitlink.
export async function assertFileChanges(
  connection: RepositoryTransport,
  repoPath: string,
  files: string[],
  allowGitlinks = false,
): Promise<void> {
  files.forEach((file) => validateRepositoryPath(repoPath, file));
  const index = await runGit(connection, repoPath, ['ls-files', '--stage', '-z', '--', ...files]);
  if (index.exitCode !== 0) throw new Error(`无法核验暂存区：${index.stderr}`);
  const entries = index.stdout.split('\0').filter(Boolean);
  const requested = new Set(files);
  const indexedPaths = entries.map((entry) => entry.slice(entry.indexOf('\t') + 1));
  const gitlinks = new Set(
    entries
      .filter((entry) => entry.startsWith('160000 '))
      .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
  );
  if (!allowGitlinks && indexedPaths.some((path) => !requested.has(path)))
    throw new Error('请选择单个文件；目录和嵌套仓库不能作为文件操作。');
  await connection.withSftp(async (sftp) => {
    const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
    const stats = new Map<string, ReturnType<typeof stat>>();
    const inspect = (path: string) => {
      if (!stats.has(path)) stats.set(path, stat(sftp, path));
      return stats.get(path)!;
    };
    for (const file of files) {
      connection.signal?.throwIfAborted();
      if (gitlinks.has(file)) {
        if (allowGitlinks) continue;
        throw new Error('子模块请在对应仓库中处理，不能作为普通文件放弃。');
      }
      let target = root;
      const parts = file.split('/');
      for (let i = 0; i < parts.length; i++) {
        target = joinRepositoryPath(target, parts[i]);
        const disk = await inspect(target);
        if (!disk) {
          if (indexedPaths.some((path) => path.startsWith(file + '/')))
            throw new Error('请选择单个文件；不能通过目录批量暂存删除。');
          break;
        }
        if (i === parts.length - 1) {
          if (disk.isDirectory())
            throw new Error('目录或嵌套仓库不能作为普通文件操作，请打开对应仓库。');
        } else if (!disk.isDirectory()) {
          // Staging a directory-to-file replacement updates only the index.
          // Checkout must still reject this case to preserve the replacement.
          if (allowGitlinks && disk.isFile() && indexedPaths.includes(file)) break;
          throw new Error('路径经过符号链接或文件，请刷新状态并单独处理。');
        } else if (await inspect(joinRepositoryPath(target, '.git'))) {
          throw new Error('路径经过符号链接、文件或嵌套仓库，请刷新状态并在对应仓库中处理。');
        }
      }
    }
  });
}

export async function ignoreDirectory(
  connection: RepositoryTransport,
  repoPath: string,
  path: string,
) {
  if (typeof path !== 'string' || /[\r\n]/.test(path))
    throw new Error('目录路径包含换行，无法写入忽略规则。');
  const relative = path.replace(/\/$/, '');
  validateRepositoryPath(repoPath, relative);
  const status = await runGit(connection, repoPath, [
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
  ]);
  if (status.exitCode !== 0) throw new Error(status.stderr);
  if (
    !parseStatus(status.stdout).files.some(
      (file) => file.path === relative + '/' && file.status === 'untracked',
    )
  )
    throw new Error('此目录已不存在或不再是未跟踪目录，请刷新后重试。');
  const excluded = await runGit(connection, repoPath, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  if (excluded.exitCode !== 0) throw new Error(excluded.stderr);
  const metadataPath = excluded.stdout.replace(/\r?\n$/, '');
  // --git-path info/exclude may resolve a symlink before we can inspect it.
  // Start at the common metadata directory so lstat sees the link itself.
  const excludePath = joinRepositoryPath(
    isWindowsPath(repoPath) ? metadataPath.replace(/\\/g, '/') : metadataPath,
    'info/exclude',
  );
  const pattern = '/' + relative.replace(/[\\*?\[\]#! ]/g, '\\$&') + '/';
  await connection.withSftp(async (sftp) => {
    const parent = posix.dirname(excludePath);
    const info = await stat(sftp, parent);
    if (info && !info.isDirectory()) throw new Error('本地忽略目录不是普通目录，无法写入。');
    if (!info) await promisify(sftp.mkdir.bind(sftp))(parent);
    const existing = await stat(sftp, excludePath);
    if (existing && !existing.isFile()) throw new Error('本地忽略文件不是普通文件，无法写入。');
    connection.signal?.throwIfAborted();
    // Append rather than rewrite, preserving existing rules and concurrent additions.
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(excludePath, { flags: 'a' });
      const abort = () => {
        reject(new Error('忽略操作已取消，请刷新状态核对结果。'));
        stream.destroy();
      };
      connection.signal?.addEventListener('abort', abort, { once: true });
      stream.on('error', reject);
      stream.on('close', () => {
        connection.signal?.removeEventListener('abort', abort);
        resolve();
      });
      if (connection.signal?.aborted) {
        abort();
        return;
      }
      stream.end('\n' + pattern + '\n');
    });
  });
  return { success: true, pattern };
}
