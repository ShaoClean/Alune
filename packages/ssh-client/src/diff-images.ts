import { posix } from 'path';
import { promisify } from 'util';
import {
  DIFF_IMAGE_MAX_BYTES,
  diffImageMediaType,
} from '@remote-git/shared';
import type { DiffImageContent, DiffImageOptions, DiffImageSide } from '@remote-git/shared';
import { SSHConnection, CommandOutputLimitError } from './connection-manager';
import { gitFileCommand, isWindowsPath } from './git-shell';

export class DiffImageError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// A side that never had content is not an error: the viewer shows "新增"/"删除".
export class DiffImageAbsentError extends DiffImageError {
  constructor(message = '此版本没有该图片。') {
    super(message, 404);
  }
}

const limitMessage = `图片超出预览限制（${DIFF_IMAGE_MAX_BYTES / (1024 * 1024)} MiB），请在远端查看。`;

function validateFilePath(file: string): void {
  if (
    !file ||
    file.startsWith('/') ||
    file.includes('\0') ||
    file
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
  )
    throw new DiffImageError('文件路径必须是仓库内的相对文件路径。');
}

export class DiffImages {
  constructor(private readonly connection: SSHConnection) {}

  private async git(repoPath: string, args: string[], signal?: AbortSignal) {
    return this.connection.execCommand(gitFileCommand(repoPath, args), undefined, signal);
  }

  // Which Git object each side of a comparison refers to. Returning null means
  // the side has no content, which the caller reports as added/deleted.
  private revisions(options: DiffImageOptions): { blob: string | null; worktree: boolean } {
    const { side, commit, parentCommit, staged, file } = options;
    if (commit) {
      if (side === 'after') return { blob: `${commit}:${file}`, worktree: false };
      return { blob: `${parentCommit || `${commit}^`}:${file}`, worktree: false };
    }
    if (staged) {
      if (side === 'after') return { blob: `:0:${file}`, worktree: false };
      return { blob: `HEAD:${file}`, worktree: false };
    }
    if (side === 'after') return { blob: null, worktree: true };
    // Unstaged comparisons are index → worktree, matching `git diff`.
    return { blob: `:0:${file}`, worktree: false };
  }

  async read(
    repoPath: string,
    options: DiffImageOptions,
    signal?: AbortSignal,
  ): Promise<DiffImageContent> {
    validateFilePath(options.file);
    if (isWindowsPath(repoPath) && /[\\:]/.test(options.file))
      throw new DiffImageError('Windows 仓库中的文件路径必须使用 / 分隔，不能包含反斜杠或冒号。');
    if (options.side !== 'before' && options.side !== 'after')
      throw new DiffImageError('请指定变更前或变更后的图片版本。');
    const mediaType = diffImageMediaType(options.file);
    if (!mediaType) throw new DiffImageError('此文件类型不支持图片预览。');

    const { blob, worktree } = this.revisions(options);
    const bytes = worktree
      ? await this.readWorktree(repoPath, options.file)
      : await this.readBlob(repoPath, blob!, signal);
    return {
      path: options.file,
      side: options.side as DiffImageSide,
      mediaType,
      byteLength: bytes.length,
      content: bytes.toString('base64'),
    };
  }

  private async readBlob(repoPath: string, spec: string, signal?: AbortSignal): Promise<Buffer> {
    const type = await this.git(repoPath, ['cat-file', '-t', spec], signal);
    if (type.exitCode !== 0) throw new DiffImageAbsentError();
    if (type.stdout.trim() !== 'blob') throw new DiffImageError('此路径不是可预览的文件。');
    const size = await this.git(repoPath, ['cat-file', '-s', spec], signal);
    if (size.exitCode !== 0) throw new DiffImageAbsentError();
    if (Number(size.stdout.trim()) > DIFF_IMAGE_MAX_BYTES) throw new DiffImageError(limitMessage);

    try {
      const result = await this.connection.execCommand(
        gitFileCommand(repoPath, ['cat-file', 'blob', spec]),
        undefined,
        signal,
        { maxOutputBytes: DIFF_IMAGE_MAX_BYTES, binary: true },
      );
      if (result.exitCode !== 0)
        throw new DiffImageError(
          `无法读取图片：${result.stderr.trim() || '远端 Git 命令失败，请刷新后重试。'}`,
        );
      return result.stdoutBytes ?? Buffer.alloc(0);
    } catch (error) {
      if (error instanceof CommandOutputLimitError) throw new DiffImageError(limitMessage);
      throw error;
    }
  }

  private async readWorktree(repoPath: string, file: string): Promise<Buffer> {
    try {
      return await this.connection.withSftp(async (sftp) => {
        // SFTP resolves Windows drive paths as well as POSIX paths without shell syntax.
        const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
        const target = posix.join(root, file);
        const stat = await promisify(sftp.lstat.bind(sftp))(target);
        if (!stat.isFile()) throw new DiffImageError('仅支持预览普通文件。');
        if (stat.size > DIFF_IMAGE_MAX_BYTES) throw new DiffImageError(limitMessage);
        const chunks: Buffer[] = [];
        let read = 0;
        for await (const chunk of sftp.createReadStream(target)) {
          read += (chunk as Buffer).length;
          if (read > DIFF_IMAGE_MAX_BYTES) throw new DiffImageError(limitMessage);
          chunks.push(chunk as Buffer);
        }
        return Buffer.concat(chunks);
      });
    } catch (error) {
      if (error instanceof DiffImageError) throw error;
      const code = (error as { code?: number | string })?.code;
      if (code === 2 || code === 'ENOENT') throw new DiffImageAbsentError();
      if (code === 3 || code === 'EACCES') throw new DiffImageError('无法读取图片：没有读取权限。');
      throw error;
    }
  }
}
