import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { LfsPointer, LfsStatus } from '@alune/shared';
import { runGit, type RepositoryTransport } from './repository-transport';
import { joinRepositoryPath } from './repository-path';
import { readSftpChunks } from './sftp-file';

// Large stdin payloads can stall Windows OpenSSH. Bound bytes, not path count;
// each scan uses at most two of the shared connection's four session slots.
const ATTRIBUTE_BATCH_BYTES = 4096;
const ATTRIBUTE_CONCURRENCY = 2;

function attributeBatches(files: string): Buffer[] {
  const batches: Buffer[] = [];
  let paths: Buffer[] = [];
  let size = 0;
  for (const path of files.split('\0')) {
    if (!path) continue;
    const bytes = Buffer.from(path + '\0', 'utf8');
    if (bytes.length > ATTRIBUTE_BATCH_BYTES)
      throw new Error('文件路径过长，无法安全检测 LFS 属性。');
    if (size + bytes.length > ATTRIBUTE_BATCH_BYTES) {
      batches.push(Buffer.concat(paths, size));
      paths = [];
      size = 0;
    }
    paths.push(bytes);
    size += bytes.length;
  }
  if (size) batches.push(Buffer.concat(paths, size));
  return batches;
}

export class GitLfs {
  constructor(private readonly connection: RepositoryTransport) {}

  async status(repoPath: string): Promise<LfsStatus> {
    const version = await runGit(this.connection, repoPath, ['lfs', 'version']);
    const files = await runGit(this.connection, repoPath, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    if (files.exitCode !== 0) throw new Error(files.stderr || '无法检测 LFS 文件。');
    const used = await this.hasLfsAttributes(repoPath, files.stdout);
    const installed = version.exitCode === 0;
    return {
      used,
      installed,
      ...(installed ? { version: version.stdout.trim() } : {}),
      ...(used && !installed
        ? {
            message:
              '此仓库使用 Git LFS，但仓库所在主机未安装 git-lfs。请在该主机安装并运行 git lfs install。',
          }
        : {}),
    };
  }

  private async hasLfsAttributes(repoPath: string, files: string): Promise<boolean> {
    const batches = attributeBatches(files);
    const controller = new AbortController();
    const signal = this.connection.signal
      ? AbortSignal.any([controller.signal, this.connection.signal])
      : controller.signal;
    let next = 0;
    let used = false;
    await Promise.all(
      Array.from({ length: Math.min(ATTRIBUTE_CONCURRENCY, batches.length) }, async () => {
        try {
          while (!used && next < batches.length) {
            signal.throwIfAborted();
            const attrs = await runGit(
              this.connection,
              repoPath,
              ['check-attr', '-z', '--stdin', 'filter'],
              signal,
              { stdin: batches[next++] },
            );
            signal.throwIfAborted();
            if (attrs.exitCode !== 0) throw new Error(attrs.stderr || '无法检测 LFS 属性。');
            const fields = attrs.stdout.split('\0');
            if (fields.some((value, index) => index % 3 === 2 && value === 'lfs')) used = true;
          }
        } catch (error) {
          // A failed batch cancels its sibling and prevents further queued work.
          controller.abort(error);
          throw error;
        }
      }),
    );
    return used;
  }

  // Reading a preview never downloads objects. Respect custom LFS storage and
  // linked worktrees using git-lfs when present, with the standard cache fallback.
  async readObject(repoPath: string, pointer: LfsPointer, limit: number): Promise<Buffer | null> {
    if (pointer.size > limit)
      throw new Error(`LFS 文件超出预览限制（${limit / 1024 / 1024} MiB）。`);
    const location = await runGit(this.connection, repoPath, [
      'lfs',
      'contentlocation',
      pointer.oid,
    ]);
    let target = location.exitCode === 0 ? location.stdout.trimEnd() : '';
    if (!target) {
      const storage = await runGit(this.connection, repoPath, ['config', '--get', 'lfs.storage']);
      if (storage.exitCode !== 0 && storage.exitCode !== 1)
        throw new Error(storage.stderr || '无法读取 LFS 存储配置。');
      const common = await runGit(this.connection, repoPath, ['rev-parse', '--git-common-dir']);
      if (common.exitCode !== 0) throw new Error(common.stderr || '无法定位 LFS 缓存。');
      const absolute = (value: string) => /^(\/|[a-z]:[\\/])/i.test(value);
      const gitDir = absolute(common.stdout.trimEnd())
        ? common.stdout.trimEnd()
        : joinRepositoryPath(repoPath, common.stdout.trimEnd());
      const configured = storage.stdout.trimEnd();
      const base = configured
        ? absolute(configured)
          ? configured
          : joinRepositoryPath(gitDir, configured)
        : joinRepositoryPath(gitDir, 'lfs');
      target = joinRepositoryPath(
        base,
        'objects',
        pointer.oid.slice(0, 2),
        pointer.oid.slice(2, 4),
        pointer.oid,
      );
    } else if (!/^(\/|[a-z]:[\\/])/i.test(target)) target = joinRepositoryPath(repoPath, target);
    return this.connection.withSftp(async (sftp) => {
      try {
        const stat = await promisify(sftp.lstat.bind(sftp))(target);
        if (!stat.isFile() || stat.size !== pointer.size)
          throw new Error('LFS 对象大小不匹配或不是普通文件，请重新拉取。');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of readSftpChunks(sftp, target)) {
          size += chunk.length;
          if (size > limit || size > pointer.size) throw new Error('LFS 对象超出预览限制。');
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        if (
          bytes.length !== pointer.size ||
          createHash('sha256').update(bytes).digest('hex') !== pointer.oid
        )
          throw new Error('LFS 对象校验失败，请重新拉取。');
        return bytes;
      } catch (error) {
        const code = (error as { code?: string | number }).code;
        if (code === 'ENOENT' || code === 2) return null;
        throw error;
      }
    });
  }
}
