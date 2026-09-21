import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import type { SFTPWrapper } from 'ssh2';
import type { NewFileDeletionPreview } from '@alune/shared';
import { SSHConnection } from './connection-manager';
import { parseStatus } from './git-status';
import { gitFileCommand, isWindowsPath } from './git-shell';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const missing = (error: any) => error?.code === 2 || error?.code === 'ENOENT';

export class NewFileDeletionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
  }
}

export function validateNewFilePath(path: unknown): asserts path is string {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\0') ||
    posix.isAbsolute(path) ||
    /^[a-z]:/i.test(path) ||
    path
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
  ) {
    throw new NewFileDeletionError(
      '请选择仓库内单个文件的相对路径，不能删除目录或仓库外路径。',
      400,
    );
  }
}

type DiskSnapshot = { root: string; fingerprint: string | null };
type Snapshot = NewFileDeletionPreview & { disk: DiskSnapshot; indexed: boolean };

// The protocol deliberately unlinks a single SFTP path. git rm without --cached
// also removes empty parent directories, and git clean may expand its scope.
export class NewFileDeletion {
  constructor(private readonly connection: SSHConnection) {}

  private async git(repoPath: string, args: string[]) {
    const result = await this.connection.execCommand(
      gitFileCommand(repoPath, args),
      undefined,
      AbortSignal.timeout(15_000),
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '远端 Git 命令未完成');
    return result.stdout;
  }

  private async disk(sftp: SFTPWrapper, repoPath: string, path: string): Promise<DiskSnapshot> {
    const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
    const target = posix.join(root, path);
    const parent = posix.dirname(target);
    let ancestor = root;
    for (const part of path.split('/').slice(0, -1)) {
      ancestor = posix.join(ancestor, part);
      try {
        const stat = await promisify(sftp.lstat.bind(sftp))(ancestor);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new NewFileDeletionError(
            '目标文件的父目录包含符号链接或已变为文件，无法安全删除。',
          );
        }
      } catch (error) {
        if (missing(error)) return { root, fingerprint: null };
        throw error;
      }
    }
    const actualParent = await promisify(sftp.realpath.bind(sftp))(parent);
    if (actualParent !== parent) {
      throw new NewFileDeletionError('目标文件的父目录包含符号链接，无法安全删除。');
    }
    let before;
    try {
      before = await promisify(sftp.lstat.bind(sftp))(target);
    } catch (error) {
      if (missing(error)) return { root, fingerprint: null };
      throw error;
    }
    if (!before.isFile() && !before.isSymbolicLink()) {
      throw new NewFileDeletionError(
        '仅支持删除单个普通文件或符号链接，不能删除目录、子模块或特殊文件。',
      );
    }
    const hash = createHash('sha256');
    if (before.isSymbolicLink()) hash.update(await promisify(sftp.readlink.bind(sftp))(target));
    else {
      const stream = sftp.createReadStream(target);
      for await (const chunk of stream) hash.update(chunk);
    }
    const after = await promisify(sftp.lstat.bind(sftp))(target);
    const attributes = (stat: typeof before) => [
      stat.mode,
      stat.size,
      stat.mtime,
      stat.uid,
      stat.gid,
    ];
    if (digest(attributes(before)) !== digest(attributes(after))) {
      throw new NewFileDeletionError('文件在读取期间发生变化，请重新确认。');
    }
    return { root, fingerprint: digest([attributes(after), hash.digest('hex')]) };
  }

  private async inspect(repoPath: string, path: string): Promise<Snapshot> {
    validateNewFilePath(path);
    if (isWindowsPath(repoPath) && /[\\:]/.test(path)) {
      throw new NewFileDeletionError(
        'Windows 仓库中的文件路径必须使用 / 分隔，不能包含反斜杠或冒号。',
        400,
      );
    }
    // A registered subdirectory must not reinterpret repository-relative paths.
    if ((await this.git(repoPath, ['rev-parse', '--show-prefix'])).trim()) {
      throw new NewFileDeletionError('请从仓库根目录操作此文件。');
    }
    const status = parseStatus(
      await this.git(repoPath, [
        'status',
        '--porcelain=v2',
        '--branch',
        '-z',
        '--untracked-files=all',
      ]),
    );
    const records = status.records.filter((record) => record.path === path);
    const record = records[0];
    if (
      records.length !== 1 ||
      !record ||
      !(
        record.kind === '?' ||
        (record.kind === '1' && (record.xy[0] === 'A' || record.xy === '.A'))
      )
    ) {
      throw new NewFileDeletionError('文件已消失或不再是新增文件，请刷新后重新操作。');
    }
    const index = await this.git(repoPath, ['ls-files', '--stage', '-z', '--', path]);
    const entries = index.split('\0').filter(Boolean);
    if (
      (record.kind === '?' && entries.length) ||
      (record.kind === '1' &&
        (entries.length !== 1 ||
          !/^\d+ [a-f0-9]+ 0\t/.test(entries[0]) ||
          entries[0].slice(entries[0].indexOf('\t') + 1) !== path ||
          entries[0].startsWith('160000 ')))
    ) {
      throw new NewFileDeletionError('暂存区状态已变化或目标为子模块，请刷新后重试。');
    }
    if (!status.head) throw new NewFileDeletionError('无法核验仓库 HEAD，未执行删除。');
    if (
      status.head !== '(initial)' &&
      (await this.git(repoPath, ['ls-tree', '-z', status.head, '--', path]))
    ) {
      throw new NewFileDeletionError('此路径已经存在于 HEAD，不能作为新增文件删除。');
    }
    const disk = await this.connection.withSftp((sftp) => this.disk(sftp, repoPath, path));
    if (record.kind === '?' && disk.fingerprint === null) {
      throw new NewFileDeletionError('文件已从远端磁盘消失，请刷新列表。');
    }
    return {
      path,
      disk,
      indexed: entries.length > 0,
      staged: record.xy[0] === 'A',
      hasUnstagedChanges: record.kind === '?' || record.xy[1] !== '.',
      diskPresent: disk.fingerprint !== null,
      token: digest([path, status.head, status.branch, record.raw, index, disk]),
    };
  }

  async preview(repoPath: string, path: string): Promise<NewFileDeletionPreview> {
    const { disk, indexed, ...preview } = await this.inspect(repoPath, path);
    return preview;
  }

  async delete(repoPath: string, path: string, token: string): Promise<{ success: true }> {
    validateNewFilePath(path);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      throw new NewFileDeletionError('请先读取文件状态并确认删除范围。', 400);
    }
    const snapshot = await this.inspect(repoPath, path);
    if (snapshot.token !== token) {
      throw new NewFileDeletionError('文件内容、暂存区或分支已变化，未执行删除。请重新确认。');
    }
    try {
      // Remove the index entry first, including in unborn repositories. If unlink
      // fails, the disk content is preserved as untracked and can be retried.
      if (snapshot.indexed) {
        await this.git(repoPath, ['rm', '--cached', '-f', '--', path]);
      }
      if (snapshot.diskPresent) {
        // A force-added ignored file becomes invisible to status after unstage.
        // Check HEAD and index directly, without requiring a new '?' status row.
        const current = parseStatus(
          await this.git(repoPath, [
            'status',
            '--porcelain=v2',
            '--branch',
            '-z',
            '--untracked-files=all',
          ]),
        );
        if (
          !current.head ||
          (await this.git(repoPath, ['ls-files', '--stage', '-z', '--', path])) ||
          (current.head !== '(initial)' &&
            (await this.git(repoPath, ['ls-tree', '-z', current.head, '--', path])))
        ) {
          throw new NewFileDeletionError('文件已被重新暂存或提交，已停止删除磁盘文件。');
        }
        await this.connection.withSftp(async (sftp) => {
          if (digest(await this.disk(sftp, repoPath, path)) !== digest(snapshot.disk)) {
            throw new NewFileDeletionError('删除前文件或父目录发生变化，已停止删除。');
          }
          await promisify(sftp.unlink.bind(sftp))(posix.join(snapshot.disk.root, path));
        });
      }
      const outcome = await this.outcome(repoPath, path);
      if (outcome.disk !== '已不存在' || outcome.index !== '已清理') {
        throw new Error('无法确认删除结果，文件可能被重新创建或暂存');
      }
      return { success: true };
    } catch (error) {
      const outcome = await this.outcome(repoPath, path);
      throw new NewFileDeletionError(
        `删除未完成：${reason(error)}。磁盘文件：${outcome.disk}；暂存记录：${outcome.index}。请刷新后重新操作。`,
        502,
      );
    }
  }

  private async outcome(repoPath: string, path: string) {
    let disk = '无法确认（连接或路径不可用）';
    let index = '无法确认（连接或 Git 不可用）';
    try {
      disk = await this.connection.withSftp(async (sftp) => {
        const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
        try {
          await promisify(sftp.lstat.bind(sftp))(posix.join(root, path));
          return '仍存在';
        } catch (error) {
          if (missing(error)) return '已不存在';
          throw error;
        }
      });
    } catch {
      /* Do not report success when the connection is lost. */
    }
    try {
      index = (await this.git(repoPath, ['ls-files', '--stage', '-z', '--', path]))
        ? '仍存在'
        : '已清理';
    } catch {
      /* Partial completion must remain explicit. */
    }
    return { disk, index };
  }
}
