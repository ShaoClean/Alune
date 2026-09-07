import { SSHConnection } from './connection-manager';
import type {
  FileStatus,
  CommitInfo,
  BranchInfo,
  StashEntry,
  RemoteInfo,
  DiffOptions,
  LogOptions,
} from '@remote-git/shared';

export class GitCommands {
  constructor(private connection: SSHConnection) {}

  private _quoteArg(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  private _git(repoPath: string, args: string): string {
    return `git -C ${this._quoteArg(repoPath)} ${args}`;
  }

  async status(repoPath: string): Promise<{
    branch: string;
    ahead: number;
    behind: number;
    files: FileStatus[];
  }> {
    const result = await this.connection.execCommand(
      this._git(repoPath, 'status --porcelain=v2 --branch'),
    );

    if (result.exitCode !== 0) {
      throw new Error(`git status failed: ${result.stderr}`);
    }

    const lines = result.stdout.split('\n').filter(Boolean);
    let branch = '';
    let ahead = 0;
    let behind = 0;
    const files: FileStatus[] = [];

    for (const line of lines) {
      if (line.startsWith('# branch.head')) {
        branch = line.split(' ').slice(1).join(' ').trim() || branch;
      } else if (line.startsWith('# branch.ab')) {
        const ab = line.split(' ').slice(1);
        for (const part of ab) {
          if (part.startsWith('+')) ahead = parseInt(part.slice(1), 10) || 0;
          if (part.startsWith('-')) behind = parseInt(part.slice(1), 10) || 0;
        }
      } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
        const fileStatus = this._parseFileStatusLine(line);
        if (fileStatus) files.push(fileStatus);
      } else if (line.startsWith('? ')) {
        files.push({
          path: line.slice(2),
          status: 'untracked',
          staged: false,
        });
      } else if (line.startsWith('! ')) {
        files.push({
          path: line.slice(2),
          status: 'ignored',
          staged: false,
        });
      }
    }

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
    if (options?.file) args += ` -- "${options.file}"`;
    if (options?.commit) {
      if (options.parentCommit) {
        args = `diff ${options.parentCommit} ${options.commit}`;
      } else {
        args = `diff ${options.commit}^..${options.commit}`;
      }
      if (options?.file) args += ` -- "${options.file}"`;
    }

    const result = await this.connection.execCommand(this._git(repoPath, args));
    if (result.exitCode !== 0) {
      throw new Error(`git diff failed: ${result.stderr}`);
    }
    return result.stdout;
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

  private _parseFileStatusLine(line: string): FileStatus | null {
    if (line.startsWith('1 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const filePath = parts.slice(8).join(' ');
      const statusCode = xy[0] === '.' ? xy[1] : xy[0];
      const staged = xy[0] !== '.' && xy[0] !== '?';

      const statusMap: Record<string, FileStatus['status']> = {
        M: 'modified', A: 'added', D: 'deleted',
        R: 'renamed', C: 'copied',
      };

      return {
        path: filePath,
        status: statusMap[statusCode] || 'modified',
        staged,
      };
    }

    if (line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const origPath = parts[parts.length - 2];
      const newPath = parts[parts.length - 1];
      const staged = xy[0] !== '.';

      return {
        path: newPath,
        oldPath: origPath,
        status: 'renamed',
        staged,
      };
    }

    if (line.startsWith('u ')) {
      const parts = line.split(' ');
      const filePath = parts.slice(9).join(' ');
      return { path: filePath, status: 'modified', staged: false };
    }

    return null;
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
