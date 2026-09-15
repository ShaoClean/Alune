import { SSHConnection } from './connection-manager';
import { parseStatus } from './git-status';
import { isWindowsPath, quotePosixArgument } from './git-shell';
import type {
  FileStatus,
  CommitInfo,
  BranchInfo,
  StashEntry,
  RemoteInfo,
  CommitFile,
  DiffOptions,
  LogOptions,
} from '@remote-git/shared';

export class GitCommands {
  constructor(private connection: SSHConnection) {}

  private _quoteArg(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private _git(repoPath: string, args: string): string {
    const path = isWindowsPath(repoPath) ? this._quoteArg(repoPath) : quotePosixArgument(repoPath);
    return `git -C ${path} ${args}`;
  }

  async status(repoPath: string, signal?: AbortSignal): Promise<{
    branch: string;
    ahead: number;
    behind: number;
    files: FileStatus[];
  }> {
    const result = await this.connection.execCommand(
      this._git(repoPath, 'status --porcelain=v2 --branch -z --untracked-files=all'),
      undefined,
      signal,
    );

    if (result.exitCode !== 0) {
      throw new Error(`git status failed: ${result.stderr}`);
    }

    const { branch, ahead, behind, files } = parseStatus(result.stdout);
    return { branch, ahead, behind, files };
  }

  async log(repoPath: string, options?: LogOptions): Promise<CommitInfo[]> {
    const count = Number(options?.count) || 50;
    const skip = Number(options?.skip) || 0;
    const format = '--format="%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%D"';

    let cmd = this._git(repoPath, `log ${format} --max-count=${count} --skip=${skip}`);
    if (options?.branch) cmd += ` ${options.branch}`;
    if (options?.file) cmd += ` -- "${options.file}"`;
    if (options?.author) cmd += ` --author="${options.author}"`;
    if (options?.search) cmd += ` --grep="${options.search}"`;

    const result = await this.connection.execCommand(cmd);
    if (result.exitCode !== 0) {
      throw new Error(`git log failed: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => this._parseLogLine(line))
      .filter((c): c is CommitInfo => c !== null);
  }

  async diff(repoPath: string, options?: DiffOptions): Promise<string> {
    let args = 'diff';
    if (options?.staged) args += ' --staged';
    if (options?.commit) {
      if (options.parentCommit) {
        args = `diff ${this._quoteArg(options.parentCommit)} ${this._quoteArg(options.commit)}`;
      } else {
        // `show` also handles the first commit in a repository, which has no
        // `<commit>^` parent to use in a `git diff` range.
        args = `show --first-parent --format= --patch ${this._quoteArg(options.commit)}`;
      }
    }
    if (options?.file) args += ` -- ${this._quoteArg(options.file)}`;

    const result = await this.connection.execCommand(this._git(repoPath, args));
    if (result.exitCode !== 0) {
      throw new Error(`git diff failed: ${result.stderr}`);
    }
    return result.stdout;
  }

  async commitFiles(repoPath: string, commit: string, parentCommit?: string): Promise<CommitFile[]> {
    const commitArg = this._quoteArg(commit);
    const nameStatusArgs = parentCommit
      ? `diff --no-color --name-status -z -M ${this._quoteArg(parentCommit)} ${commitArg}`
      : `show --first-parent --format= --name-status -z --find-renames ${commitArg}`;
    const nameStatusResult = await this.connection.execCommand(this._git(repoPath, nameStatusArgs));
    if (nameStatusResult.exitCode !== 0) {
      throw new Error(`git commit files failed: ${nameStatusResult.stderr}`);
    }

    const files = this._parseCommitNameStatus(nameStatusResult.stdout);
    if (files.length === 0) return files;

    const numstatArgs = parentCommit
      ? `diff --no-color --numstat -z -M ${this._quoteArg(parentCommit)} ${commitArg}`
      : `show --first-parent --format= --no-patch --numstat -z --find-renames ${commitArg}`;
    const numstatResult = await this.connection.execCommand(this._git(repoPath, numstatArgs));
    if (numstatResult.exitCode !== 0) {
      throw new Error(`git commit file stats failed: ${numstatResult.stderr}`);
    }

    const stats = this._parseCommitNumstat(numstatResult.stdout);
    return files.map((file, index) => ({ ...file, ...(stats[index] || {}) }));
  }

  async branchList(repoPath: string): Promise<BranchInfo[]> {
    const result = await this.connection.execCommand(
      this._git(repoPath, 'branch -a -v --no-color'),
    );
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
    const result = await this.connection.execCommand(this._git(repoPath, 'stash list'));
    if (result.exitCode !== 0) {
      throw new Error(`git stash list failed: ${result.stderr}`);
    }

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line, index) => this._parseStashLine(line, index))
      .filter((s): s is StashEntry => s !== null);
  }

  async remoteList(repoPath: string): Promise<RemoteInfo[]> {
    const result = await this.connection.execCommand(this._git(repoPath, 'remote -v'));
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

  async execute(repoPath: string, args: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return this.connection.execCommand(this._git(repoPath, args));
  }

  private _parseCommitNameStatus(output: string): CommitFile[] {
    const tokens = output.split('\0');
    const files: CommitFile[] = [];
    const statusMap: Record<string, CommitFile['status']> = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      R: 'renamed',
      C: 'copied',
    };

    for (let index = 0; index < tokens.length;) {
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

  private _parseCommitNumstat(output: string): Array<Pick<CommitFile, 'additions' | 'deletions'>> {
    const tokens = output.split('\0');
    const stats: Array<Pick<CommitFile, 'additions' | 'deletions'>> = [];

    const parseCount = (value: string): number | undefined => {
      if (!/^\d+$/.test(value)) return undefined;
      return Number(value);
    };

    for (let index = 0; index < tokens.length;) {
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

  private _parseLogLine(line: string): CommitInfo | null {
    try {
      const cleaned = line.replace(/^"|"$/g, '');
      const parts = cleaned.split('\0');
      if (parts.length < 7) return null;

      return {
        hash: parts[0],
        shortHash: parts[1],
        message: parts[2],
        author: parts[3],
        email: parts[4],
        date: new Date(parts[5]),
        refs: parts[6] ? parts[6].split(',').map((r) => r.trim()).filter(Boolean) : [],
      };
    } catch {
      return null;
    }
  }

  private _parseBranchLine(line: string): BranchInfo | null {
    try {
      const isCurrent = line.startsWith('*');
      const cleaned = line.replace(/^\*?\s+/, '');
      const isRemote = cleaned.startsWith('remotes/');

      const parts = cleaned.split(/\s+/);
      const name = parts[0];
      const lastCommit = parts.slice(1).join(' ');

      return {
        name,
        isHead: isCurrent,
        isRemote,
        isCurrent,
      };
    } catch {
      return null;
    }
  }

  private _parseStashLine(line: string, index: number): StashEntry | null {
    const match = line.match(/^(\d+):\s+(?:WIP on|On)\s+(\S+):\s+(.+)$/);
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
