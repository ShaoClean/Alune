import type { RepositoryOperationState } from '@alune/domain';
import { promisify } from 'util';
import type { RepositoryFileSystem as SFTPWrapper } from '../../ports/repository-files';
import { joinRepositoryPath } from './repository-path';
import type { CommandOptions, RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';
import { readSftpChunks } from './sftp-file';

const STATE_FILE_MAX_BYTES = 64 * 1024;
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function firstLine(value: string | undefined): string | undefined {
  const line = value?.split('\n')[0].trim();
  return line || undefined;
}

function objectId(value: string | undefined): string | undefined {
  const id = firstLine(value);
  return id && OBJECT_ID.test(id) ? id : undefined;
}

function count(value: string | undefined): number | undefined {
  const line = firstLine(value);
  return line && /^\d+$/.test(line) ? Number(line) : undefined;
}

function branchName(value: string | undefined): string | undefined {
  const ref = firstLine(value);
  if (!ref || ref === 'detached HEAD') return undefined;
  return ref.replace(/^refs\/heads\//, '');
}

// Git writes "Merge branch 'x'", "Merge remote-tracking branch 'origin/x'",
// "Merge tag 'v1'" or "Merge commit 'abc'" as the first MERGE_MSG line.
function mergedName(message: string | undefined): string | undefined {
  return firstLine(message)?.match(
    /^Merge (?:remote-tracking )?(?:branch|branches|tag|commit) '([^']+)'/,
  )?.[1];
}

async function readSmall(sftp: SFTPWrapper, path: string): Promise<string | undefined> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of readSftpChunks(sftp, path)) {
      size += chunk.length;
      if (size > STATE_FILE_MAX_BYTES) break;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return undefined;
  }
}

export class GitOperationReads {
  constructor(protected readonly connection: RepositoryTransport) {}

  // Mirrors `git status`: the state files live in the worktree's own Git
  // directory, which for linked worktrees is not `<worktree>/.git`.
  async state(
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<RepositoryOperationState | undefined> {
    const dir = await runGit(
      this.connection,
      repoPath,
      ['rev-parse', '--absolute-git-dir'],
      signal,
    );
    if (dir.exitCode !== 0) throw new Error(dir.stderr || '无法定位 Git 目录。');
    const gitDir = dir.stdout.replace(/\r?\n$/, '');
    if (!gitDir) return undefined;
    return this.stateInGitDirectory(repoPath, gitDir, signal);
  }

  async stateInGitDirectory(
    repoPath: string,
    gitDir: string,
    signal?: AbortSignal,
  ): Promise<RepositoryOperationState | undefined> {
    const state = await this.connection.withSftp<RepositoryOperationState | undefined>(
      async (sftp) => {
        const names = new Set(
          (await promisify(sftp.readdir.bind(sftp))(gitDir)).map((entry) => entry.filename),
        );
        const read = (...parts: string[]) => readSmall(sftp, joinRepositoryPath(gitDir, ...parts));
        const exists = (...parts: string[]) =>
          promisify(sftp.lstat.bind(sftp))(joinRepositoryPath(gitDir, ...parts)).then(
            () => true,
            () => false,
          );
        if (names.has('rebase-merge')) {
          const [headName, onto, step, total, rebaseHead, stopped] = await Promise.all([
            read('rebase-merge', 'head-name'),
            read('rebase-merge', 'onto'),
            read('rebase-merge', 'msgnum'),
            read('rebase-merge', 'end'),
            names.has('REBASE_HEAD') ? read('REBASE_HEAD') : undefined,
            read('rebase-merge', 'stopped-sha'),
          ]);
          return {
            kind: 'rebase' as const,
            commit: objectId(rebaseHead) ?? objectId(stopped),
            branch: branchName(headName),
            onto: objectId(onto),
            step: count(step),
            total: count(total),
          };
        }
        // rebase-apply is shared with `git am`, which Alune does not drive.
        if (names.has('rebase-apply') && !(await exists('rebase-apply', 'applying'))) {
          const [headName, onto, step, total, rebaseHead, original] = await Promise.all([
            read('rebase-apply', 'head-name'),
            read('rebase-apply', 'onto'),
            read('rebase-apply', 'next'),
            read('rebase-apply', 'last'),
            names.has('REBASE_HEAD') ? read('REBASE_HEAD') : undefined,
            read('rebase-apply', 'original-commit'),
          ]);
          return {
            kind: 'rebase' as const,
            commit: objectId(rebaseHead) ?? objectId(original),
            branch: branchName(headName),
            onto: objectId(onto),
            step: count(step),
            total: count(total),
          };
        }
        if (names.has('MERGE_HEAD')) {
          const [head, message] = await Promise.all([read('MERGE_HEAD'), read('MERGE_MSG')]);
          return { kind: 'merge' as const, commit: objectId(head), branch: mergedName(message) };
        }
        if (names.has('CHERRY_PICK_HEAD'))
          return { kind: 'cherry-pick' as const, commit: objectId(await read('CHERRY_PICK_HEAD')) };
        if (names.has('REVERT_HEAD'))
          return { kind: 'revert' as const, commit: objectId(await read('REVERT_HEAD')) };
        return undefined;
      },
    );
    if (!state) return undefined;
    const result = Object.fromEntries(
      Object.entries(state).filter(([, value]) => value !== undefined),
    ) as unknown as RepositoryOperationState;
    if (result.commit) {
      const subject = await runGit(
        this.connection,
        repoPath,
        ['log', '-1', '--format=%s', result.commit, '--'],
        signal,
      );
      if (subject.exitCode === 0 && subject.stdout.trim()) result.subject = subject.stdout.trim();
    }
    return result;
  }
}
