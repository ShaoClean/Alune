import type {
  BranchInfo,
  CommitFile,
  DiffOptions,
  FileStatus,
  LogOptions,
  LogPage,
  RemoteInfo,
  StashEntry,
} from '@alune/domain';
import { promisify } from 'util';
import { CommandOutputLimitError } from '../../ports/process';
import { classifyChanges } from './change-entries';
import { readLog } from './git-log';
import { isWindowsPath } from './git-shell';
import { parseStatus } from './git-status';
import { joinRepositoryPath } from './repository-path';
import type { RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';

export const DIFF_PREVIEW_MAX_BYTES = 1024 * 1024;
const previewLimitMessage = '文件或差异超出预览限制（1 MiB），请在仓库中查看。';
export class GitReads {
  constructor(protected connection: RepositoryTransport) {}

  async status(
    repoPath: string,
    signal?: AbortSignal,
    refreshIndex = false,
  ): Promise<{
    branch: string;
    ahead: number;
    behind: number;
    files: FileStatus[];
    unborn?: boolean;
    upstream?: string;
  }> {
    const result = await runGit(
      this.connection,
      repoPath,
      [
        ...(refreshIndex ? [] : ['--no-optional-locks']),
        'status',
        '--porcelain=v2',
        '--branch',
        '-z',
        '--untracked-files=all',
      ],
      signal,
    );

    if (result.exitCode !== 0) {
      throw new Error(`git status failed: ${result.stderr}`);
    }

    const { branch, ahead, behind, files, head, upstream } = parseStatus(result.stdout);
    await classifyChanges(this.connection, repoPath, files, signal);
    return {
      branch,
      ahead,
      behind,
      files,
      ...(head === '(initial)' ? { unborn: true } : {}),
      ...(upstream ? { upstream } : {}),
    };
  }

  async log(repoPath: string, options?: LogOptions): Promise<LogPage> {
    return readLog(this.connection, repoPath, options);
  }

  async diff(repoPath: string, options?: DiffOptions): Promise<string> {
    if (options?.file !== undefined) this._validateFilePath(options.file);
    if (options?.file && isWindowsPath(repoPath) && /[\\:]/.test(options.file))
      throw new Error('Windows 仓库中的文件路径必须使用 / 分隔，不能包含反斜杠或冒号。');
    const flags = [
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--submodule=log',
      options?.fullFile ? '--unified=2147483647' : '--unified=3',
    ];
    let args = ['diff', ...flags];
    let untracked = false;
    if (options?.file && !options.commit) {
      const file = options.file;
      const index = await runGit(this.connection, repoPath, [
        'ls-files',
        '--stage',
        '-z',
        '--',
        file,
      ]);
      if (index.exitCode !== 0) throw new Error(`无法读取暂存区：${index.stderr}`);
      const entries = index.stdout.split('\0').filter(Boolean);
      if (entries.some((entry) => entry.slice(entry.indexOf('\t') + 1) !== file))
        throw new Error('请选择单个文件查看差异。');

      if (options.staged && entries.length) {
        // Check the indexed blob, never the worktree: the file may have been edited or removed.
        for (const entry of entries) {
          if (entry.startsWith('160000 ')) continue; // A gitlink is not a blob in this repository.
          const hash = entry.split(' ')[1];
          const size = await runGit(this.connection, repoPath, ['cat-file', '-s', hash]);
          if (size.exitCode !== 0) throw new Error(`无法读取暂存内容：${size.stderr}`);
          if (Number(size.stdout.trim()) > DIFF_PREVIEW_MAX_BYTES)
            throw new Error(previewLimitMessage);
        }
      } else if (!options.staged && !entries.length) {
        const others = await runGit(this.connection, repoPath, [
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
          '--',
          file,
        ]);
        if (others.exitCode !== 0) throw new Error(`无法读取文件状态：${others.stderr}`);
        if (!others.stdout.split('\0').includes(file))
          throw new Error('文件已不存在或状态已改变，请刷新仓库状态。');
        untracked = true;
        await this._checkPreviewFile(repoPath, file);
        args = ['diff', ...flags, '--no-index', '--', '/dev/null', file];
      }
    }
    if (options?.staged) args.push('--staged');
    if (options?.commit) {
      if (options.parentCommit) {
        args = ['diff', ...flags, options.parentCommit, options.commit];
      } else {
        // `show` also handles the first commit in a repository, which has no
        // `<commit>^` parent to use in a `git diff` range.
        args = ['show', ...flags, '--first-parent', '--format=', '--patch', options.commit];
      }
    }
    if (options?.file && !untracked) args.push('--', options.file);

    try {
      const result = await runGit(
        this.connection,
        repoPath,
        ['-c', 'core.quotepath=false', ...args],
        undefined,
        { maxOutputBytes: DIFF_PREVIEW_MAX_BYTES, strictUtf8: true },
      );
      // --no-index reports a successful comparison with differences using exit code 1.
      if (
        result.exitCode !== 0 &&
        !(untracked && result.exitCode === 1 && (result.stdout || !result.stderr.trim()))
      )
        throw new Error(`无法读取差异：${result.stderr || '远端 Git 命令失败，请刷新后重试。'}`);
      if (result.stdout.split('\n').length > 10_000)
        throw new Error('差异超过 10,000 行，无法预览，请在仓库中查看。');
      return result.stdout;
    } catch (error) {
      if (error instanceof CommandOutputLimitError) throw new Error(previewLimitMessage);
      if (
        error instanceof TypeError &&
        'code' in error &&
        error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
      )
        throw new Error('文件不是有效的 UTF-8 文本，暂不支持预览。');
      throw error;
    }
  }

  protected async _checkPreviewFile(repoPath: string, file: string): Promise<void> {
    try {
      await this.connection.withSftp(async (sftp) => {
        // SFTP resolves Windows drive paths as well as POSIX paths without shell syntax.
        const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
        const target = joinRepositoryPath(root, file);
        const stat = await promisify(sftp.lstat.bind(sftp))(target);
        // Git previews the link itself, including dangling links, not its target.
        if (stat.isSymbolicLink()) return;
        if (!stat.isFile()) throw new Error('仅支持预览普通文件或符号链接。');
        if (stat.size > DIFF_PREVIEW_MAX_BYTES) throw new Error(previewLimitMessage);
        // Opening read-only checks permissions/ACLs without downloading the file.
        const handle = await promisify(sftp.open.bind(sftp))(target, 'r');
        await promisify(sftp.close.bind(sftp))(handle);
      });
    } catch (error) {
      const code = (error as { code?: number | string })?.code;
      if (code === 2 || code === 'ENOENT')
        throw new Error('文件已不存在或状态已改变，请刷新仓库状态。');
      if (code === 3 || code === 'EACCES') throw new Error('无法读取文件：没有读取权限。');
      throw error;
    }
  }

  protected _validateFilePath(file: string): void {
    if (
      !file ||
      file.startsWith('/') ||
      file.includes('\0') ||
      file
        .split('/')
        .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
    )
      throw new Error('文件路径必须是仓库内的相对文件路径。');
  }

  async commitFiles(
    repoPath: string,
    commit: string,
    parentCommit?: string,
  ): Promise<CommitFile[]> {
    if (
      [commit, parentCommit].some(
        (value) => value !== undefined && (!value || value.startsWith('-') || value.includes('\0')),
      )
    )
      throw new Error('无效的提交引用。');
    const nameStatusArgs = parentCommit
      ? ['diff', '--no-color', '--name-status', '-z', '-M', parentCommit, commit, '--']
      : [
          'show',
          '--first-parent',
          '--format=',
          '--name-status',
          '-z',
          '--find-renames',
          commit,
          '--',
        ];
    const nameStatusResult = await runGit(this.connection, repoPath, nameStatusArgs);
    if (nameStatusResult.exitCode !== 0) {
      throw new Error(`git commit files failed: ${nameStatusResult.stderr}`);
    }

    const files = this._parseCommitNameStatus(nameStatusResult.stdout);
    if (files.length === 0) return files;

    const numstatArgs = parentCommit
      ? ['diff', '--no-color', '--numstat', '-z', '-M', parentCommit, commit, '--']
      : ['show', '--first-parent', '--format=', '--numstat', '-z', '--find-renames', commit, '--'];
    const numstatResult = await runGit(this.connection, repoPath, numstatArgs);
    if (numstatResult.exitCode !== 0) {
      throw new Error(`git commit file stats failed: ${numstatResult.stderr}`);
    }

    const stats = this._parseCommitNumstat(numstatResult.stdout);
    return files.map((file, index) => ({ ...file, ...(stats[index] || {}) }));
  }

  async branchList(repoPath: string): Promise<BranchInfo[]> {
    const result = await runGit(this.connection, repoPath, [
      'for-each-ref',
      '--format=%(refname)%00%(HEAD)%00%(upstream)%00%(symref)',
      'refs/heads/',
      'refs/remotes/',
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`git branch failed: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => this._parseBranchLine(line))
      .filter((b): b is BranchInfo => b !== null);
  }

  async stashList(repoPath: string): Promise<StashEntry[]> {
    const result = await runGit(this.connection, repoPath, ['stash', 'list']);
    if (result.exitCode !== 0) {
      throw new Error(`git stash list failed: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line, index) => this._parseStashLine(line, index))
      .filter((s): s is StashEntry => s !== null);
  }

  async remoteList(repoPath: string, signal?: AbortSignal): Promise<RemoteInfo[]> {
    const result = await runGit(this.connection, repoPath, ['remote', '-v'], signal, {
      maxOutputBytes: 1024 * 1024,
    });
    if (result.exitCode !== 0) {
      throw new Error(`git remote failed: ${result.stderr}`);
    }

    const remotes = new Map<string, RemoteInfo>();
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
      if (match) {
        const [, name, url, type] = match;
        if (!remotes.has(name)) {
          remotes.set(name, { name, fetchUrl: '', pushUrl: '' });
        }
        const remote = remotes.get(name)!;
        if (type === 'fetch') remote.fetchUrl = url;
        else remote.pushUrl = url;
      }
    }

    return Array.from(remotes.values());
  }

  protected _parseCommitNameStatus(output: string): CommitFile[] {
    const tokens = output.split('\0');
    const files: CommitFile[] = [];
    const statusMap: Record<string, CommitFile['status']> = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      R: 'renamed',
      C: 'copied',
    };

    for (let index = 0; index < tokens.length; ) {
      const statusToken = tokens[index++];
      if (!statusToken) continue;

      const code = statusToken[0];
      const status = statusMap[code] || 'modified';
      if (code === 'R' || code === 'C') {
        const oldPath = tokens[index++] || '';
        const path = tokens[index++] || '';
        if (path) files.push({ path, oldPath, status });
      } else {
        const path = tokens[index++] || '';
        if (path) files.push({ path, status });
      }
    }

    return files;
  }

  protected _parseCommitNumstat(
    output: string,
  ): Array<Pick<CommitFile, 'additions' | 'deletions'>> {
    const tokens = output.split('\0');
    const stats: Array<Pick<CommitFile, 'additions' | 'deletions'>> = [];

    const parseCount = (value: string): number | undefined => {
      if (!/^\d+$/.test(value)) return undefined;
      return Number(value);
    };

    for (let index = 0; index < tokens.length; ) {
      const statToken = tokens[index++];
      if (!statToken) continue;

      const firstTab = statToken.indexOf('\t');
      const secondTab = statToken.indexOf('\t', firstTab + 1);
      if (firstTab < 0 || secondTab < 0) continue;

      const additions = parseCount(statToken.slice(0, firstTab));
      const deletions = parseCount(statToken.slice(firstTab + 1, secondTab));
      const path = statToken.slice(secondTab + 1);

      // With -z, rename/copy entries put the old and new paths in the two
      // tokens following an empty path field.
      if (!path) index += 2;
      stats.push({ additions, deletions });
    }

    return stats;
  }

  protected _parseBranchLine(line: string): BranchInfo | null {
    const [ref, head, upstream, symref] = line.split('\0');
    if (symref || !/^refs\/(heads|remotes)\//.test(ref)) return null;
    const isRemote = ref.startsWith('refs/remotes/');
    const isCurrent = head === '*';
    return {
      name: ref.slice(isRemote ? 'refs/'.length : 'refs/heads/'.length),
      isHead: isCurrent,
      isRemote,
      isCurrent,
      ...(upstream ? { upstream: upstream.replace(/^refs\/(remotes|heads)\//, '') } : {}),
    };
  }

  protected _parseStashLine(line: string, index: number): StashEntry | null {
    const match = line.match(/^stash@\{(\d+)\}:\s+(?:WIP on|On)\s+(\S+):\s+(.+)$/);
    if (match) {
      return {
        index: parseInt(match[1], 10),
        branch: match[2],
        message: match[3],
      };
    }
    return { index, message: line };
  }
}
