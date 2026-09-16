import { createHash } from 'node:crypto';
import { SSHConnection, CommandOutputLimitError } from './connection-manager';
import { gitFileCommand } from './git-shell';

export const AI_DIFF_MAX_BYTES = 96 * 1024;
export class StagedChangesError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class StagedChanges {
  constructor(
    private connection: SSHConnection,
    private repoPath: string,
  ) {}

  private async diff(args: string[], signal: AbortSignal, maxOutputBytes: number) {
    try {
      const result = await this.connection.execCommand(
        gitFileCommand(this.repoPath, [
          'diff',
          '--cached',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--ignore-submodules=none',
          ...args,
        ]),
        undefined,
        signal,
        { maxOutputBytes },
      );
      if (result.exitCode !== 0)
        throw new StagedChangesError('无法读取暂存差异，请检查仓库连接与 Git 状态。', 502);
      if (Buffer.byteLength(result.stdout, 'utf8') > maxOutputBytes)
        throw new CommandOutputLimitError();
      return result.stdout;
    } catch (error) {
      if (error instanceof CommandOutputLimitError)
        throw new StagedChangesError(
          '已暂存差异超过 AI 生成限制（96 KiB），请减少本次暂存内容后重试。',
          413,
        );
      throw error;
    }
  }

  async revision(signal: AbortSignal) {
    const raw = await this.diff(['--raw', '--no-abbrev', '-z'], signal, 256 * 1024);
    if (!raw) throw new StagedChangesError('没有已暂存的改动，请先暂存需要提交的文件。');
    if (/:\d+ \d+ [a-f\d]+ [a-f\d]+ U\0/.test(raw))
      throw new StagedChangesError('请先解决暂存区中的合并冲突。');
    return createHash('sha256').update(raw).digest('hex');
  }

  async read(signal: AbortSignal) {
    const revision = await this.revision(signal);
    // No --binary: binary changes contribute names/status only, never binary payloads.
    const diff = await this.diff(['--unified=3'], signal, AI_DIFF_MAX_BYTES);
    await this.assertRevision(revision, signal);
    return { revision, diff };
  }

  async assertRevision(revision: string, signal: AbortSignal) {
    let current: string;
    try {
      current = await this.revision(signal);
    } catch (error) {
      if (!(error instanceof StagedChangesError) || error.statusCode !== 400) throw error;
      throw new StagedChangesError('暂存内容已变化，本次结果已丢弃，请重新生成。', 409);
    }
    if (current !== revision)
      throw new StagedChangesError('暂存内容已变化，本次结果已丢弃，请重新生成。', 409);
  }
}
