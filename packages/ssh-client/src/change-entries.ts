import { posix } from 'node:path';
import { promisify } from 'node:util';
import type { SFTPWrapper } from 'ssh2';
import { isWindowsPath } from './git-shell';
import { parseStatus } from './git-status';
import { validateRepositoryPath } from './repository-files';
import { joinRepositoryPath } from './repository-path';
import { runGit, type RepositoryTransport } from './repository-transport';

const missing = (error: any) =>
  error?.code === 2 || error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
async function stat(sftp: SFTPWrapper, path: string) {
  try {
    return await promisify(sftp.lstat.bind(sftp))(path);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

export {
  assertFileChanges,
  classifyChanges,
  specialChangeReason,
} from '@alune/agent/git/change-entries';
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
