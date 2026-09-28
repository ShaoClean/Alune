import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import type { SFTPWrapper } from 'ssh2';
import type {
  DiscardChangesPreview,
  DiscardChangesResult,
  DiscardChangesScope,
  SkippedChange,
} from '@alune/shared';
import { specialChangeReason } from './change-entries';
import { parseStatus, type StatusRecord } from './git-status';
import { isWindowsPath } from './git-shell';
import { validateNewFilePath } from './new-file-deletion';
import { joinRepositoryPath } from './repository-path';
import { runGit, type RepositoryTransport } from './repository-transport';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const missing = (error: any) => error?.code === 2 || error?.code === 'ENOENT';
type Disk = { root: string; fingerprint: string | null };
type Target = { record: StatusRecord; disk: Disk };

export class DiscardChangesError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
  }
}

class DirectoryTarget extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

const underSkipped = (path: string, skipped: SkippedChange[]) =>
  skipped.some((item) => {
    const root = item.path.replace(/\/$/, '');
    return path === root || path === root + '/' || path.startsWith(root + '/');
  });

export function validateDiscardChangesRequest(token: unknown, scope: unknown) {
  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token) ||
    (scope !== 'tracked' && scope !== 'all')
  ) {
    throw new DiscardChangesError('请先读取仓库状态并确认放弃范围。', 400);
  }
}

// Both transports use the same plan and literal paths. No reset, index removal,
// recursive clean, or traversal into another repository is part of this operation.
export class DiscardChanges {
  constructor(private readonly connection: RepositoryTransport) {}

  private async git(repoPath: string, args: string[]) {
    const result = await runGit(
      this.connection,
      repoPath,
      ['--no-optional-locks', ...args],
      AbortSignal.timeout(30_000),
      { strictUtf8: true },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Git 命令未完成。');
    return result.stdout;
  }

  private async state(repoPath: string) {
    const raw = await this.git(repoPath, [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ]);
    const status = parseStatus(raw);
    if (!status.head) throw new DiscardChangesError('无法核验仓库 HEAD，未执行放弃操作。');
    const index = await this.git(repoPath, ['ls-files', '--stage', '-z']);
    return { raw, status, index };
  }

  private targets(records: StatusRecord[]) {
    if (records.some((record) => record.kind === 'u')) {
      throw new DiscardChangesError('仓库存在合并冲突，请先解决冲突后再放弃所有更改。');
    }
    return records.filter(
      (record) => record.kind === '?' || (['1', '2'].includes(record.kind) && record.xy[1] !== '.'),
    );
  }

  private validateTarget(repoPath: string, record: StatusRecord) {
    if (record.xy === '.A') {
      throw new DiscardChangesError(
        `“${record.path}”仅标记为意向添加（git add -N），请先暂存或取消暂存后重试。`,
      );
    }
    try {
      validateNewFilePath(record.path);
    } catch {
      throw new DiscardChangesError(`“${record.path}”不是可安全处理的仓库文件路径。`);
    }
    if (isWindowsPath(repoPath) && /[\\:]/.test(record.path)) {
      throw new DiscardChangesError('Windows 文件路径包含不支持的分隔符或冒号，无法安全放弃。');
    }
  }

  private async disk(sftp: SFTPWrapper, repoPath: string, path: string): Promise<Disk> {
    this.connection.signal?.throwIfAborted();
    const root = await promisify(sftp.realpath.bind(sftp))(repoPath);
    const target = joinRepositoryPath(root, path);
    let ancestor = root;
    for (const part of path.split('/').slice(0, -1)) {
      ancestor = joinRepositoryPath(ancestor, part);
      try {
        const stat = await promisify(sftp.lstat.bind(sftp))(ancestor);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          throw new DiscardChangesError(`“${path}”的父目录是符号链接或文件，无法安全放弃。`);
        }
      } catch (error) {
        if (missing(error)) return { root, fingerprint: null };
        throw error;
      }
      try {
        await promisify(sftp.lstat.bind(sftp))(joinRepositoryPath(ancestor, '.git'));
        throw new DirectoryTarget(
          ancestor.slice(root.length + 1),
          '嵌套仓库或 Worktree，请在对应仓库中处理',
        );
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    if (
      (await promisify(sftp.realpath.bind(sftp))(posix.dirname(target))) !== posix.dirname(target)
    ) {
      throw new DiscardChangesError(`“${path}”的父目录已变化，无法安全放弃。`);
    }
    let before;
    try {
      before = await promisify(sftp.lstat.bind(sftp))(target);
    } catch (error) {
      if (missing(error)) return { root, fingerprint: null };
      throw error;
    }
    if (before.isDirectory()) throw new DirectoryTarget(path, '此路径已变为目录，请单独处理');
    if (!before.isFile() && !before.isSymbolicLink()) {
      throw new DiscardChangesError(`“${path}”是目录或特殊文件，无法批量放弃。`);
    }
    const hash = createHash('sha256');
    if (before.isSymbolicLink()) hash.update(await promisify(sftp.readlink.bind(sftp))(target));
    else {
      const stream = sftp.createReadStream(target);
      for await (const chunk of stream) {
        this.connection.signal?.throwIfAborted();
        hash.update(chunk);
      }
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
      throw new DiscardChangesError(`“${path}”在读取期间发生变化，请重新确认。`);
    }
    return { root, fingerprint: digest([attributes(after), hash.digest('hex')]) };
  }

  private async inspect(repoPath: string) {
    if ((await this.git(repoPath, ['rev-parse', '--show-prefix'])).trim()) {
      throw new DiscardChangesError('请从仓库或 worktree 的根目录放弃所有更改。');
    }
    const state = await this.state(repoPath);
    const records = this.targets(state.status.records);
    const skipped: SkippedChange[] = records.flatMap((record) => {
      const reason = specialChangeReason(record);
      return reason ? [{ path: record.path, reason }] : [];
    });
    const inspected = await this.connection.withSftp(async (sftp) => {
      const targets: Target[] = [];
      for (const record of records) {
        if (underSkipped(record.path, skipped)) continue;
        this.validateTarget(repoPath, record);
        try {
          targets.push({ record, disk: await this.disk(sftp, repoPath, record.path) });
        } catch (error) {
          if (!(error instanceof DirectoryTarget)) throw error;
          skipped.push({ path: error.path, reason: error.message });
        }
      }
      return targets;
    });
    const targets = inspected.filter(({ record }) => !underSkipped(record.path, skipped));
    const latest = await this.state(repoPath);
    if (latest.raw !== state.raw || latest.index !== state.index) {
      throw new DiscardChangesError('读取期间仓库状态已变化，请重新确认。');
    }
    const preview: DiscardChangesPreview = {
      repositoryPath: repoPath,
      tracked: targets.filter(({ record }) => record.kind !== '?').length,
      untracked: targets.filter(({ record }) => record.kind === '?').length,
      token: digest([repoPath, state.raw, state.index, targets, skipped]),
      ...(skipped.length ? { skipped } : {}),
    };
    return { state, targets, preview };
  }

  async preview(repoPath: string): Promise<DiscardChangesPreview> {
    return (await this.inspect(repoPath)).preview;
  }

  async discard(
    repoPath: string,
    token: string,
    scope: DiscardChangesScope,
  ): Promise<DiscardChangesResult> {
    validateDiscardChangesRequest(token, scope);
    const plan = await this.inspect(repoPath);
    if (plan.preview.token !== token) {
      throw new DiscardChangesError('文件内容、暂存区或分支已变化，未执行放弃操作。请重新确认。');
    }
    const targets = plan.targets.filter(({ record }) => scope === 'all' || record.kind !== '?');
    let error: string | undefined;
    try {
      for (let i = 0; i < targets.length; i++) {
        const current = await this.state(repoPath);
        const remaining = this.targets(current.status.records).filter(
          (record) =>
            !underSkipped(record.path, plan.preview.skipped || []) &&
            (scope === 'all' || record.kind !== '?'),
        );
        if (
          current.index !== plan.state.index ||
          current.status.head !== plan.state.status.head ||
          current.status.branch !== plan.state.status.branch ||
          digest(remaining) !== digest(targets.slice(i).map(({ record }) => record))
        ) {
          throw new DiscardChangesError('操作期间仓库状态发生变化，已停止后续步骤。请重新确认。');
        }
        const { record, disk } = targets[i];
        await this.connection.withSftp(async (sftp) => {
          if (digest(await this.disk(sftp, repoPath, record.path)) !== digest(disk)) {
            throw new DiscardChangesError(`“${record.path}”的内容或路径已变化，已停止后续步骤。`);
          }
          if (record.kind === '?') {
            this.connection.signal?.throwIfAborted();
            await promisify(sftp.unlink.bind(sftp))(joinRepositoryPath(disk.root, record.path));
          }
        });
        if (record.kind !== '?') {
          await this.git(repoPath, [
            'restore',
            '--worktree',
            '--no-recurse-submodules',
            '--',
            record.path,
          ]);
        }
      }
    } catch (failure) {
      error = reason(failure);
    }
    // A lost SSH acknowledgement can follow a successful write. Always inspect
    // the actual outcome, and explicitly report unknown results if reads fail.
    const result: DiscardChangesResult = {
      success: false,
      restored: 0,
      deleted: 0,
      remaining: 0,
      unknown: 0,
    };
    try {
      const current = await this.state(repoPath);
      const indexChanged = current.index !== plan.state.index;
      const branchChanged =
        current.status.head !== plan.state.status.head ||
        current.status.branch !== plan.state.status.branch;
      if (indexChanged || branchChanged)
        error ||= '暂存区或分支被其他操作修改，请核对最新仓库状态。';
      for (const { record } of targets) {
        if (record.kind !== '?') {
          if (indexChanged || branchChanged) result.unknown++;
          else if (
            current.status.records.some(
              (entry) => entry.path === record.path && (entry.kind === 'u' || entry.xy[1] !== '.'),
            )
          )
            result.remaining++;
          else result.restored++;
        } else {
          try {
            const disk = await this.connection.withSftp((sftp) =>
              this.disk(sftp, repoPath, record.path),
            );
            if (disk.fingerprint === null) result.deleted++;
            else result.remaining++;
          } catch (failure) {
            result.unknown++;
            error ||= reason(failure);
          }
        }
      }
    } catch (failure) {
      result.unknown = targets.length;
      error = [error, `无法核验最终状态：${reason(failure)}`].filter(Boolean).join('；');
    }
    result.success = !error && result.remaining === 0 && result.unknown === 0;
    if (!result.success) result.error = error || '仍有文件未完成，请刷新后重新确认。';
    return result;
  }
}
