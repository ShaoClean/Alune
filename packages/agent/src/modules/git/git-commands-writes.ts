import { GitReads } from './git-commands';
import { assertFileChanges } from './change-entries';
import { isWindowsPath, quotePosixArgument } from './git-shell';
import { signingFailure } from './git-signing';
import type { RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';

export { DIFF_PREVIEW_MAX_BYTES } from './git-commands';
export class GitCommands extends GitReads {
  declare protected connection: RepositoryTransport;
  constructor(connection: RepositoryTransport) {
    super(connection);
  }

  private _git(repoPath: string, args: string): string {
    const path = isWindowsPath(repoPath)
      ? `"${repoPath.replace(/"/g, '\\"')}"`
      : quotePosixArgument(repoPath);
    return `git -C ${path} ${args}`;
  }

  async stage(repoPath: string, files: string[]): Promise<void> {
    await this._changeIndex(repoPath, files, 'add');
  }

  async commit(repoPath: string, message: string, amend?: string) {
    if (!message.trim() || message.includes('\0'))
      throw new Error('提交信息不能为空或包含 NUL 字符。');
    if (amend !== undefined) {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(amend))
        throw new Error('请选择要修改的完整提交哈希。');
      const head = await runGit(this.connection, repoPath, ['rev-parse', '--verify', 'HEAD']);
      if (head.exitCode !== 0 || head.stdout.trim() !== amend)
        throw new Error('上一次提交已变化，请重新选择后重试。');
    }
    const result = await runGit(this.connection, repoPath, [
      'commit',
      ...(amend ? ['--amend'] : []),
      '--cleanup=verbatim',
      '-m',
      message,
    ]);
    if (result.exitCode !== 0) result.stderr = signingFailure(result.stderr || result.stdout);
    return result;
  }

  async unstage(repoPath: string, files: string[]): Promise<void> {
    const head = await runGit(this.connection, repoPath, [
      'rev-parse',
      '--verify',
      '--quiet',
      'HEAD',
    ]);
    if (head.exitCode !== 0 && head.exitCode !== 1) throw new Error(head.stderr);
    // An unborn branch has no HEAD to reset against; removing only index entries preserves files.
    await this._changeIndex(repoPath, files, head.exitCode === 0 ? 'reset HEAD' : 'rm --cached -f');
  }

  private async _changeIndex(repoPath: string, files: string[], command: string): Promise<void> {
    if (!files.length) throw new Error('请选择文件。');
    files.forEach((file) => this._validateFilePath(file));
    if (command === 'add') await assertFileChanges(this.connection, repoPath, files, true);
    const result = await runGit(this.connection, repoPath, [...command.split(' '), '--', ...files]);
    if (result.exitCode !== 0) throw new Error(result.stderr);
  }

  async execute(
    repoPath: string,
    args: string | string[],
    signal?: AbortSignal,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    if (Array.isArray(args)) return runGit(this.connection, repoPath, args, signal);
    if (this.connection.execGit) throw new Error('本地仓库不接受 shell 命令。');
    return this.connection.execCommand(
      this._git(repoPath, args),
      undefined,
      signal ?? this.connection.signal,
    );
  }
}
