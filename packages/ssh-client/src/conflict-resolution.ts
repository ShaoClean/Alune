import { GitOperationReads } from '@alune/agent/git/conflict-resolution';
import type {
  ConflictBlockChoice,
  ConflictSide,
  ConflictStepResult,
  RepositoryOperationKind,
  RepositoryOperationState,
} from '@alune/shared';
import {
  ConflictMarkerError,
  REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
  resolveConflictBlock,
} from '@alune/shared';
import type { SFTPWrapper } from 'ssh2';
import { promisify } from 'util';
import {
  decodeTextPreview,
  resolveRepositoryDirectory,
  validateRepositoryPath,
} from './repository-files';
import { joinRepositoryPath } from './repository-path';
import type { CommandOptions, RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';
import { readSftpChunks } from './sftp-file';

export class ConflictResolutionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// Continue/skip must never wait for an editor. Git keeps the prepared message,
// exactly as `git <operation> --continue` does after closing the editor.
const NON_INTERACTIVE: CommandOptions = { environment: { GIT_EDITOR: 'true' } };
function sftpError(error: unknown): never {
  if (error instanceof ConflictResolutionError) throw error;
  const code = (error as { code?: number | string })?.code;
  if (code === 2 || code === 'ENOENT')
    throw new ConflictResolutionError('文件已不存在，请刷新仓库状态。', 404);
  if (code === 3 || code === 'EACCES')
    throw new ConflictResolutionError('没有读写此文件的权限。', 403);
  throw new ConflictResolutionError(
    error instanceof Error && error.message ? error.message : '无法读写冲突文件。',
  );
}
export class ConflictResolution extends GitOperationReads {
  declare protected connection: RepositoryTransport;
  constructor(connection: RepositoryTransport) {
    super(connection);
  }

  async unmerged(repoPath: string, files?: string[]): Promise<string[]> {
    const result = await runGit(this.connection, repoPath, [
      'ls-files',
      '--unmerged',
      '-z',
      ...(files ? ['--', ...files] : []),
    ]);
    if (result.exitCode !== 0) throw new Error(result.stderr || '无法读取冲突状态。');
    return result.stdout.split('\0').filter(Boolean);
  }

  // Takes one side for the whole file and marks it resolved, like
  // `git checkout --ours|--theirs` + `git add`, or `git rm` when that side
  // deleted the file.
  async resolveFile(repoPath: string, file: string, side: ConflictSide): Promise<void> {
    validateRepositoryPath(repoPath, file);
    if (side !== 'current' && side !== 'incoming')
      throw new ConflictResolutionError('无效的冲突解决方式。');
    const entries = await this.unmerged(repoPath, [file]);
    if (!entries.length || entries.some((entry) => entry.slice(entry.indexOf('\t') + 1) !== file))
      throw new ConflictResolutionError('此文件没有未解决的冲突，请刷新仓库状态。', 409);
    const stage = side === 'current' ? '2' : '3';
    const chosen = entries.find((entry) => entry.split('\t')[0].split(' ')[2] === stage);
    if (chosen?.startsWith('160000 '))
      throw new ConflictResolutionError('子模块冲突请在子模块中处理后再暂存。');
    const steps = chosen
      ? [
          ['checkout', side === 'current' ? '--ours' : '--theirs', '--', file],
          ['add', '--', file],
        ]
      : [['rm', '--quiet', '--force', '--', file]];
    for (const args of steps) {
      const result = await runGit(this.connection, repoPath, args);
      if (result.exitCode !== 0)
        throw new Error(result.stderr || result.stdout || '无法解决此文件的冲突。');
    }
  }

  // Rewrites one conflict block in the worktree. The file stays unmerged until
  // the user marks it resolved.
  async resolveBlock(
    repoPath: string,
    file: string,
    index: number,
    choice: ConflictBlockChoice,
    expected: string,
  ): Promise<void> {
    validateRepositoryPath(repoPath, file);
    if (!Number.isSafeInteger(index) || index < 0 || typeof expected !== 'string' || !expected)
      throw new ConflictResolutionError('无效的冲突块。');
    if (!['current', 'incoming', 'both'].includes(choice))
      throw new ConflictResolutionError('无效的冲突解决方式。');
    try {
      await this.connection.withSftp(async (sftp) => {
        const slash = file.lastIndexOf('/');
        const parent = await resolveRepositoryDirectory(
          sftp,
          repoPath,
          slash < 0 ? '' : file.slice(0, slash),
          file,
        );
        const target = joinRepositoryPath(parent, file.slice(slash + 1));
        const stat = await promisify(sftp.lstat.bind(sftp))(target);
        if (!stat.isFile()) throw new ConflictResolutionError('只能逐块解决普通文本文件。');
        if (stat.size > REPOSITORY_TEXT_PREVIEW_MAX_BYTES)
          throw new ConflictResolutionError('文件超过 1 MiB，请选择整文件版本或在编辑器中解决。');
        const chunks: Buffer[] = [];
        for await (const chunk of readSftpChunks(sftp, target)) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const text = decodeTextPreview(bytes);
        // UTF-16 round-trips are possible but rare in conflicts; avoid re-encoding them.
        if (typeof text === 'string' || text.encoding !== 'utf-8')
          throw new ConflictResolutionError('仅支持逐块解决 UTF-8 文本，请选择整文件版本。');
        const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        let resolved: string;
        try {
          resolved = resolveConflictBlock(text.content, index, choice, expected);
        } catch (error) {
          if (error instanceof ConflictMarkerError)
            throw new ConflictResolutionError(error.message, 409);
          throw error;
        }
        const output = Buffer.concat([
          bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
          Buffer.from(resolved, 'utf8'),
        ]);
        const handle = await promisify(sftp.open.bind(sftp))(target, 'w');
        try {
          for (let offset = 0; offset < output.length; ) {
            const length = Math.min(32 * 1024, output.length - offset);
            await new Promise<void>((resolve, reject) =>
              sftp.write(handle, output, offset, length, offset, (error) =>
                error ? reject(error) : resolve(),
              ),
            );
            offset += length;
          }
        } finally {
          await promisify(sftp.close.bind(sftp))(handle);
        }
      });
    } catch (error) {
      sftpError(error);
    }
  }

  continue(repoPath: string): Promise<ConflictStepResult> {
    return this.step(repoPath, 'continue');
  }

  skip(repoPath: string): Promise<ConflictStepResult> {
    return this.step(repoPath, 'skip');
  }

  async abort(repoPath: string): Promise<void> {
    const state = await this.required(repoPath);
    const result = await runGit(this.connection, repoPath, [state.kind, '--abort']);
    if (result.exitCode !== 0)
      throw new Error(result.stderr || result.stdout || '无法中止当前操作。');
  }

  private async required(repoPath: string): Promise<RepositoryOperationState> {
    const state = await this.state(repoPath);
    if (!state)
      throw new ConflictResolutionError('当前没有进行中的合并、变基、拣选或还原操作。', 409);
    return state;
  }

  private async step(repoPath: string, action: 'continue' | 'skip'): Promise<ConflictStepResult> {
    const state = await this.required(repoPath);
    const kind: RepositoryOperationKind = state.kind;
    if (action === 'skip' && kind !== 'rebase')
      throw new ConflictResolutionError('只有变基支持跳过当前提交。');
    if (action === 'continue' && (await this.unmerged(repoPath)).length)
      throw new ConflictResolutionError('仍有未解决的冲突，请先解决并标记为已解决。', 409);
    const result = await runGit(
      this.connection,
      repoPath,
      [kind, `--${action}`],
      undefined,
      NON_INTERACTIVE,
    );
    if (result.exitCode === 0) return { success: true, conflicts: false };
    // Replaying the next commit can stop on new conflicts; that is a new state, not a failure.
    if ((await this.unmerged(repoPath)).length)
      return {
        success: true,
        conflicts: true,
        message: (result.stdout + result.stderr).trim() || undefined,
      };
    throw new Error(
      result.stderr || result.stdout || `无法${action === 'skip' ? '跳过' : '继续'}当前操作。`,
    );
  }
}
