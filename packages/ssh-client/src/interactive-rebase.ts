import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { SFTPWrapper } from 'ssh2';
import {
  previewRebasePlan,
  type RebasePreview,
  type RebaseRequest,
  type RebaseState,
  type RebaseResult,
  type RebaseConflict,
  type RebaseResolution,
} from '@alune/shared';
import { runGit, type RepositoryTransport } from './repository-transport';
import { joinRepositoryPath } from './repository-path';
import { isWindowsPath, quotePosixArgument } from './git-shell';
import { readSftpChunks } from './sftp-file';
import { validateRepositoryPath } from './repository-files';

const SESSION = 'alune-interactive-rebase';
const MAX_TEXT = 64 * 1024;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing = (error: unknown) =>
  ['ENOENT', 2].includes((error as { code: string | number })?.code);
const oid = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const withoutNewline = (value: string) => value.replace(/\r?\n$/, '');

async function exists(files: SFTPWrapper, path: string) {
  try {
    await promisify(files.lstat.bind(files))(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function read(files: SFTPWrapper, path: string, limit = 1024 * 1024) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of readSftpChunks(files, path)) {
    length += chunk.length;
    if (length > limit) throw new Error('文件超出读取限制。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Explicit handles wait for CLOSE before the SSH session is released.
async function write(files: SFTPWrapper, path: string, content: string, exclusive = true) {
  const handle = await new Promise<Buffer>((resolve, reject) =>
    files.open(path, exclusive ? 'wx' : 'w', 0o600, (error, handle) =>
      error ? reject(error) : resolve(handle),
    ),
  );
  try {
    const bytes = Buffer.from(content);
    for (let offset = 0; offset < bytes.length; offset += 32 * 1024) {
      const length = Math.min(32 * 1024, bytes.length - offset);
      await new Promise<void>((resolve, reject) =>
        files.write(handle, bytes, offset, length, offset, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    }
  } finally {
    await promisify(files.close.bind(files))(handle);
  }
}

function text(bytes: Buffer): string | null {
  if (bytes.includes(0) || bytes.length > MAX_TEXT) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export class InteractiveRebase {
  constructor(private readonly connection: RepositoryTransport) {}

  private async git(root: string, args: string[]) {
    const result = await runGit(this.connection, root, args, AbortSignal.timeout(30_000));
    if (result.exitCode !== 0)
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Git 命令未完成。');
    return result.stdout;
  }

  private async directory(root: string) {
    return withoutNewline(await this.git(root, ['rev-parse', '--absolute-git-dir']));
  }

  private async hasState(directory: string): Promise<boolean> {
    // Ordinary Git operations must still work on SSH hosts without SFTP.
    // Only open the file subsystem when Git or Alune has a recovery marker.
    const paths = ['rebase-merge', 'rebase-apply', SESSION].map((name) =>
      joinRepositoryPath(directory, name),
    );
    if (this.connection.hasAnyPath) return this.connection.hasAnyPath(paths);
    let probe: string;
    if (isWindowsPath(directory)) {
      const literals = paths.map((path) => `'${path.replace(/'/g, "''")}'`).join(',');
      const script = [
        "$ErrorActionPreference = 'Stop'",
        '$found = $false',
        `foreach ($rebasePath in @(${literals})) { try { $null = Get-Item -LiteralPath $rebasePath -Force; $found = $true } catch [System.Management.Automation.ItemNotFoundException] {} }`,
        "if ($found) { [Console]::Write('active') } else { [Console]::Write('idle') }",
      ].join('; ');
      probe = `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
    } else {
      const checks = paths
        .map((path) => `[ -e ${quotePosixArgument(path)} ] || [ -L ${quotePosixArgument(path)} ]`)
        .join(' || ');
      probe = `if ${checks}; then printf active; else printf idle; fi`;
    }
    const result = await this.connection.execCommand(
      probe,
      undefined,
      AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(this.connection.signal ? [this.connection.signal] : []),
      ]),
      { maxOutputBytes: 4096 },
    );
    if (result.exitCode !== 0 || !['idle', 'active'].includes(result.stdout.trim()))
      throw new Error(result.stderr.trim() || '无法检查变基状态。');
    return result.stdout.trim() === 'active';
  }

  async state(root: string): Promise<RebaseState> {
    const directory = await this.directory(root);
    if (!(await this.hasState(directory)))
      return { active: false, managed: false, inProgress: false, conflicts: [] };
    const flags = await this.connection.withSftp(async (files) => {
      const [merge, apply, managed] = await Promise.all([
        exists(files, joinRepositoryPath(directory, 'rebase-merge')),
        exists(files, joinRepositoryPath(directory, 'rebase-apply')),
        exists(files, joinRepositoryPath(directory, SESSION)),
      ]);
      let metadata: { head?: string; branch?: string; id?: string } = {};
      if (managed) {
        const stat = await promisify(files.lstat.bind(files))(
          joinRepositoryPath(directory, SESSION),
        );
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('变基会话路径不是普通目录，请检查仓库。');
        try {
          const saved = JSON.parse(
            (
              await read(files, joinRepositoryPath(directory, `${SESSION}/session.json`))
            ).toString(),
          );
          if (saved && typeof saved === 'object') {
            metadata = {
              id: typeof saved.id === 'string' ? saved.id : undefined,
              head: oid(saved.head) ? saved.head : undefined,
              branch: typeof saved.branch === 'string' ? saved.branch : undefined,
            };
          }
        } catch (error) {
          if (!missing(error) && !(error instanceof SyntaxError)) throw error;
        }
      }
      let owned = managed && !merge && !apply;
      if (managed && merge && metadata.id) {
        try {
          owned =
            (await read(files, joinRepositoryPath(directory, 'rebase-merge/alune-session'), 128))
              .toString()
              .trim() === metadata.id;
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      return {
        active: merge || apply || managed,
        inProgress: merge || apply,
        managed: owned,
        originalHead: owned ? metadata.head : undefined,
        branch: owned ? metadata.branch : undefined,
      };
    });
    if (!flags.active) return { ...flags, conflicts: [] };
    const unmerged = await this.git(root, ['diff', '--name-only', '--diff-filter=U', '-z']);
    return { ...flags, conflicts: [...new Set(unmerged.split('\0').filter(Boolean))] };
  }

  async preview(root: string, base: string, preparing = false): Promise<RebasePreview> {
    if (!oid(base)) throw new Error('请选择完整的基准提交。');
    const directory = await this.directory(root);
    await this.connection.withSftp(async (files) => {
      const markers = [
        'rebase-merge',
        'rebase-apply',
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'sequencer',
      ];
      if (!preparing) markers.push(SESSION);
      if (
        (
          await Promise.all(
            markers.map((name) => exists(files, joinRepositoryPath(directory, name))),
          )
        ).some(Boolean)
      )
        throw new Error('仓库有未完成的 Git 操作，请先继续或中止。');
    });
    const [head, branch, dirty, remoteRefs] = await Promise.all([
      this.git(root, ['rev-parse', '--verify', 'HEAD']),
      this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.git(root, [
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ]),
      this.git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes']),
    ]);
    if (dirty) throw new Error('请先提交或储藏全部工作区改动（包括未跟踪文件）。');
    const current = head.trim();
    const ancestor = await runGit(this.connection, root, [
      'merge-base',
      '--is-ancestor',
      base,
      current,
    ]);
    if (ancestor.exitCode !== 0) throw new Error('基准必须是当前分支的祖先提交。');
    const range = `${base}..${current}`;
    const [merges, count] = await Promise.all([
      this.git(root, ['rev-list', '--merges', '--max-count=1', range]),
      this.git(root, ['rev-list', '--count', range]),
    ]);
    if (merges.trim()) throw new Error('待重写历史含合并提交，暂不支持交互式变基。');
    if (!Number(count)) throw new Error('基准之后没有可变基的提交。');
    if (Number(count) > 500) throw new Error('单次最多整理 500 个提交，请选择更近的基准。');
    const [log, unpublished] = await Promise.all([
      this.git(root, ['log', '--reverse', '-z', '--format=%H%x00%an%x00%B', range]),
      this.git(root, ['rev-list', range, '--not', '--remotes']),
    ]);
    const privateHashes = new Set(unpublished.trim().split('\n'));
    const fields = log.split('\0');
    const commits = [];
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if (!oid(fields[i])) throw new Error('无法解析提交历史。');
      commits.push({
        hash: fields[i],
        author: fields[i + 1],
        message: fields[i + 2],
        published: !privateHashes.has(fields[i]),
      });
    }
    if (commits.length !== Number(count)) throw new Error('提交历史读取不完整，请重试。');
    // Detect a checkout/commit/fetch during collection, including a branch switch at the same SHA.
    if (
      head !== (await this.git(root, ['rev-parse', '--verify', 'HEAD'])) ||
      branch !== (await this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) ||
      remoteRefs !==
        (await this.git(root, [
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/remotes',
        ]))
    )
      throw new Error('仓库历史已变化，请重新预览。');
    return {
      base,
      head: current,
      branch: branch.trim(),
      commits,
      token: digest([base, head, branch, remoteRefs, commits]),
    };
  }

  private async cleanup(directory: string) {
    await this.connection.withSftp(async (files) => {
      const session = joinRepositoryPath(directory, SESSION);
      if (!(await exists(files, session))) return;
      const stat = await promisify(files.lstat.bind(files))(session);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('变基会话路径不是普通目录，无法清理。');
      const entries = await promisify(files.readdir.bind(files))(session);
      for (const entry of entries) {
        // Only remove the exact private files we create, never recurse through a foreign directory.
        if (
          !/^(?:session\.json|todo|sequence\.sh|editor\.sh|message-[a-f0-9]+)$/.test(entry.filename)
        )
          throw new Error('变基临时目录含未知文件，请检查后重试。');
        await promisify(files.unlink.bind(files))(joinRepositoryPath(session, entry.filename));
      }
      await promisify(files.rmdir.bind(files))(session);
    });
  }

  private environment(directory: string) {
    return {
      GIT_SEQUENCE_EDITOR: `sh ${quotePosixArgument(joinRepositoryPath(directory, `${SESSION}/sequence.sh`))}`,
      GIT_EDITOR: `sh ${quotePosixArgument(joinRepositoryPath(directory, `${SESSION}/editor.sh`))}`,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
    };
  }

  private async execute(root: string, directory: string, args: string[]): Promise<RebaseResult> {
    const result = await runGit(
      this.connection,
      root,
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'commit.cleanup=verbatim',
        '-c',
        'rebase.autoStash=false',
        '-c',
        'rebase.updateRefs=false',
        '-c',
        'rebase.rescheduleFailedExec=false',
        '-c',
        'core.editor=true',
        ...args,
      ],
      undefined,
      { environment: this.environment(directory) },
    );
    let state = await this.state(root);
    if (!state.inProgress) {
      await this.cleanup(directory);
      state = await this.state(root);
    }
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    return {
      state,
      output,
      ...(result.exitCode ? { error: output || '变基未完成，请检查状态。' } : {}),
    };
  }

  async start(root: string, request: RebaseRequest): Promise<RebaseResult> {
    if (!request || typeof request.token !== 'string') throw new Error('请先预览并确认变基计划。');
    const preview = await this.preview(root, request.base);
    if (preview.token !== request.token)
      throw new Error('仓库历史或远程引用已变化，请重新预览并确认。');
    previewRebasePlan(preview.commits, request.entries);
    if (preview.commits.some((commit) => commit.published) && request.acknowledgePublished !== true)
      throw new Error('计划包含已推送提交，请确认后续可能需要强制推送。');
    const directory = await this.directory(root);
    const session = joinRepositoryPath(directory, SESSION);
    const sessionId = randomUUID();
    // Exclusive mkdir also coordinates two Alune processes addressing the same worktree.
    await this.connection.withSftp(
      (files) =>
        new Promise<void>((resolve, reject) =>
          files.mkdir(session, { mode: 0o700 }, (error) => (error ? reject(error) : resolve())),
        ),
    );
    let invoked = false;
    try {
      await this.connection.withSftp(async (files) => {
        await write(
          files,
          joinRepositoryPath(session, 'session.json'),
          JSON.stringify({ id: sessionId, head: preview.head, branch: preview.branch }),
        );
        await write(
          files,
          joinRepositoryPath(session, 'todo'),
          request.entries.map((entry) => `${entry.action} ${entry.hash}`).join('\n') + '\n',
        );
        await write(
          files,
          joinRepositoryPath(session, 'sequence.sh'),
          `#!/bin/sh\nset -eu\ncp ${quotePosixArgument(joinRepositoryPath(session, 'todo'))} "$1"\nprintf '%s\\n' ${quotePosixArgument(sessionId)} > ${quotePosixArgument(joinRepositoryPath(directory, 'rebase-merge/alune-session'))}\n`,
        );
        const cases: string[] = [];
        let message = '';
        for (const entry of request.entries) {
          if (entry.action === 'drop') continue;
          if (entry.action === 'pick')
            message = preview.commits.find((commit) => commit.hash === entry.hash)!.message;
          if (entry.action === 'reword' || entry.action === 'squash') message = entry.message!;
          const path = joinRepositoryPath(session, `message-${entry.hash}`);
          await write(files, path, message.endsWith('\n') ? message : message + '\n');
          cases.push(`${entry.hash}) cp ${quotePosixArgument(path)} "$1" ;;`);
        }
        // Git writes the current command to done before invoking its editor. Matching
        // the original OID survives conflicts, skip, consecutive squash/fixup and restart.
        await write(
          files,
          joinRepositoryPath(session, 'editor.sh'),
          `#!/bin/sh\nset -eu\ncommand=$(tail -n 1 ${quotePosixArgument(joinRepositoryPath(directory, 'rebase-merge/done'))})\nset -- "$1" $command\ncase "\${3:-}" in\n${cases.join('\n')}\n*) exit 1 ;;\nesac\n`,
        );
      });
      if ((await this.preview(root, request.base, true)).token !== request.token)
        throw new Error('仓库在准备期间发生变化，请重新预览。');
      invoked = true;
      return await this.execute(root, directory, [
        'rebase',
        '--interactive',
        '--no-autosquash',
        '--no-autostash',
        '--no-update-refs',
        '--no-rebase-merges',
        '--reapply-cherry-picks',
        '--keep-empty',
        '--empty=keep',
        request.base,
      ]);
    } catch (error) {
      // Keep scripts after uncertain transport/cancellation failures: Git may still
      // be paused remotely and must remain recoverable after reconnecting.
      if (!invoked) await this.cleanup(directory);
      throw error;
    }
  }

  async control(root: string, action: 'continue' | 'skip' | 'abort'): Promise<RebaseResult> {
    if (!['continue', 'skip', 'abort'].includes(action)) throw new Error('无效的变基操作。');
    const state = await this.state(root);
    if (!state.managed) throw new Error('当前没有由 Alune 发起的交互式变基。');
    const directory = await this.directory(root);
    if (!state.inProgress) {
      if (action !== 'abort') throw new Error('变基进程已结束或准备被中断，请清理会话后核对历史。');
      await this.cleanup(directory);
      return { state: await this.state(root), output: '已清理变基会话，请核对提交历史。' };
    }
    if (action === 'continue' && state.conflicts.length)
      throw new Error('请先解决并暂存全部冲突文件。');
    return this.execute(root, directory, ['rebase', `--${action}`]);
  }

  private async conflictSnapshot(root: string, path: string) {
    validateRepositoryPath(root, path);
    const state = await this.state(root);
    if (!state.managed || !state.inProgress || !state.conflicts.includes(path))
      throw new Error('此文件已不处于当前变基冲突中，请刷新。');
    const index = await this.git(root, ['ls-files', '--unmerged', '-z', '--', path]);
    const stages = index
      .split('\0')
      .filter(Boolean)
      .map((row) => {
        const [mode, hash, stage] = row.slice(0, row.indexOf('\t')).split(' ');
        return { mode, hash, stage: Number(stage) };
      });
    const disk = await this.connection.withSftp(async (files) => {
      const canonicalRoot = await promisify(files.realpath.bind(files))(root);
      let target = canonicalRoot;
      for (const part of path.split('/').slice(0, -1)) {
        target = joinRepositoryPath(target, part);
        const stat = await promisify(files.lstat.bind(files))(target);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('冲突路径的父目录不是普通目录。');
      }
      target = joinRepositoryPath(canonicalRoot, path);
      if (!(await exists(files, target)))
        return { target, value: null, content: null, editable: true };
      const stat = await promisify(files.lstat.bind(files))(target);
      if (stat.isSymbolicLink())
        return {
          target,
          value: await promisify(files.readlink.bind(files))(target),
          content: null,
          editable: false,
        };
      if (!stat.isFile())
        return {
          target,
          value: [stat.mode, stat.size, stat.mtime],
          content: null,
          editable: false,
        };
      const hash = createHash('sha256');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of readSftpChunks(files, target)) {
        this.connection.signal?.throwIfAborted();
        hash.update(chunk);
        length += chunk.length;
        if (length <= MAX_TEXT) chunks.push(chunk);
      }
      const content = length <= MAX_TEXT ? text(Buffer.concat(chunks)) : null;
      return { target, value: hash.digest('hex'), content, editable: content !== null };
    });
    const token = digest([state.originalHead, index, disk.value]);
    return { stages, disk, token };
  }

  async conflict(root: string, path: string): Promise<RebaseConflict> {
    const { stages, disk, token } = await this.conflictSnapshot(root, path);
    const content = async (stage: number) => {
      const entry = stages.find((entry) => entry.stage === stage);
      if (!entry || !entry.mode.startsWith('100')) return null;
      if (Number(await this.git(root, ['cat-file', '-s', entry.hash])) > MAX_TEXT) return null;
      const result = await runGit(
        this.connection,
        root,
        ['cat-file', 'blob', entry.hash],
        undefined,
        { binary: true, maxOutputBytes: MAX_TEXT },
      );
      if (result.exitCode) throw new Error(result.stderr || '无法读取冲突版本。');
      return text(result.stdoutBytes ?? Buffer.from(result.stdout));
    };
    const [ours, theirs] = await Promise.all([content(2), content(3)]);
    return {
      path,
      token,
      ours,
      theirs,
      content: disk.content,
      editable: disk.editable && stages.every((entry) => entry.mode.startsWith('100')),
      hasOurs: stages.some((entry) => entry.stage === 2),
      hasTheirs: stages.some((entry) => entry.stage === 3),
    };
  }

  async resolve(root: string, request: RebaseResolution): Promise<RebaseState> {
    if (!request || !['ours', 'theirs', 'delete', 'content'].includes(request.choice))
      throw new Error('无效的冲突处理方式。');
    const { stages, disk, token } = await this.conflictSnapshot(root, request.path);
    if (token !== request.token) throw new Error('冲突内容或暂存区已变化，请重新读取后解决。');
    if (request.choice === 'content') {
      if (
        !disk.editable ||
        !stages.every((entry) => entry.mode.startsWith('100')) ||
        typeof request.content !== 'string' ||
        request.content.includes('\0') ||
        Buffer.byteLength(request.content) > MAX_TEXT
      )
        throw new Error('仅支持编辑 64 KiB 以内的 UTF-8 普通文本文件。');
      await this.connection.withSftp((files) => write(files, disk.target, request.content!, false));
      await this.git(root, ['add', '--', request.path]);
    } else if (request.choice === 'delete') {
      await this.git(root, ['rm', '-f', '--', request.path]);
    } else {
      const stage = request.choice === 'ours' ? 2 : 3;
      if (!stages.some((entry) => entry.stage === stage))
        throw new Error('此版本不存在，可选择删除文件。');
      await this.git(root, ['checkout', `--${request.choice}`, '--', request.path]);
      await this.git(root, ['add', '--', request.path]);
    }
    return this.state(root);
  }
}
