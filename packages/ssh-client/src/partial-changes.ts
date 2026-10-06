import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { parsePatchHunks } from '@alune/shared';
import type { PartialDiffPreview, PartialDiffRequest, PatchHunk } from '@alune/shared';
import { runGit } from './repository-transport';
import type { RepositoryTransport, CommandOptions } from './repository-transport';
import { validateRepositoryPath } from './repository-files';
import { joinRepositoryPath } from './repository-path';
import { readSftpChunks } from './sftp-file';
import { GitCommands } from './git-commands';

const MAX_BYTES = 2 * 1024 * 1024;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const missing = (error: any) => error?.code === 2 || error?.code === 'ENOENT';
export class PartialChangesError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}
const stale = () =>
  new PartialChangesError('文件、暂存区或 HEAD 已变化，请刷新差异后重新选择。', 409);
class Unsupported extends Error {}
type FileContent = { text: string; mode: string } | null;

// Reconstruct the result from the trusted diff and target blob. Retained rows
// keep their original bytes, including mixed line endings and BOMs.
export function selectedContent(
  base: string,
  hunks: PatchHunk[],
  selected: Set<number>,
  reverse: boolean,
) {
  const source = split(base);
  const output: string[] = [];
  let cursor = 0;
  // Git normalizes a text-attributed CRLF worktree before diffing. Restore its
  // line endings on discard; indexed blobs are passed here without conversion.
  const normalizedCRLF =
    reverse &&
    hunks.some((hunk) => {
      let position = hunk.newCount ? hunk.newStart - 1 : hunk.newStart;
      return hunk.rows.some((row) => {
        if (row.kind === 'remove') return false;
        const actual = source[position++];
        return (
          actual?.endsWith('\r\n') &&
          !row.content.endsWith('\r\n') &&
          actual.replace(/\r\n$/, '\n') === row.content
        );
      });
    });
  for (const hunk of hunks) {
    const start = reverse ? hunk.newStart : hunk.oldStart;
    const count = reverse ? hunk.newCount : hunk.oldCount;
    const position = count ? start - 1 : start;
    if (position < cursor || position > source.length) throw stale();
    for (let i = cursor; i < position; i++) output.push(source[i]);
    cursor = position;
    for (const row of hunk.rows) {
      const consumes = row.kind === 'context' || row.kind === (reverse ? 'add' : 'remove');
      if (consumes) {
        const actual = source[cursor++];
        if (
          actual !== row.content &&
          !(normalizedCRLF && actual?.replace(/\r\n$/, '\n') === row.content)
        )
          throw stale();
        if (row.kind === 'context' || !selected.has(row.index)) output.push(actual);
      } else if (selected.has(row.index)) {
        output.push(
          normalizedCRLF && !row.content.endsWith('\r\n')
            ? row.content.replace(/\n$/, '\r\n')
            : row.content,
        );
      }
    }
  }
  for (let i = cursor; i < source.length; i++) output.push(source[i]);
  // Keeping an unterminated old line while adding a new line after it requires
  // a separator. Never concatenate two selected logical lines into one.
  return output
    .map((line, i) =>
      i < output.length - 1 && !line.endsWith('\n')
        ? line + (normalizedCRLF ? '\r\n' : '\n')
        : line,
    )
    .join('');
}

function fullPatch(file: string, before: FileContent, after: FileContent) {
  const a = JSON.stringify('a/' + file),
    b = JSON.stringify('b/' + file);
  const oldLines = split(before?.text ?? ''),
    newLines = split(after?.text ?? '');
  const rows = (lines: string[], prefix: string) =>
    lines
      .map(
        (line) => prefix + line + (line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'),
      )
      .join('');
  return (
    `diff --git ${a} ${b}\n` +
    (!before
      ? `new file mode ${after!.mode}\n`
      : !after
        ? `deleted file mode ${before.mode}\n`
        : '') +
    `--- ${before ? a : '/dev/null'}\n+++ ${after ? b : '/dev/null'}\n` +
    `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n` +
    rows(oldLines, '-') +
    rows(newLines, '+')
  );
}

export class PartialChanges {
  constructor(private connection: RepositoryTransport) {}
  private async git(root: string, args: string[], options?: CommandOptions) {
    const result = await runGit(this.connection, root, args, undefined, {
      maxOutputBytes: 8 * MAX_BYTES,
      strictUtf8: true,
      ...options,
    });
    if (result.exitCode !== 0)
      throw new PartialChangesError(result.stderr.trim() || '无法读取 Git 状态。');
    return result.stdout;
  }
  private decode(bytes: Buffer): string {
    if (bytes.length > MAX_BYTES) throw new Unsupported('文件超过 2 MiB，请使用整文件操作。');
    if (bytes.includes(0)) throw new Unsupported('二进制文件不支持按块或按行操作。');
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Unsupported('仅 UTF-8 文本支持按块或按行操作。');
    }
  }
  private async blob(root: string, entry: string): Promise<FileContent> {
    if (!entry) return null;
    const [mode, , oid] = entry.split(/[ \t]/);
    if (!/^100(644|755)$/.test(mode)) throw new Unsupported('符号链接和子模块请使用整文件操作。');
    const size = Number(await this.git(root, ['cat-file', '-s', oid]));
    if (size > MAX_BYTES) throw new Unsupported('文件超过 2 MiB，请使用整文件操作。');
    const result = await runGit(this.connection, root, ['cat-file', 'blob', oid], undefined, {
      binary: true,
      maxOutputBytes: MAX_BYTES,
    });
    if (result.exitCode !== 0 || !result.stdoutBytes) throw stale();
    return { text: this.decode(result.stdoutBytes), mode };
  }
  private async worktree(root: string, file: string): Promise<FileContent> {
    return this.connection.withSftp(async (sftp) => {
      const canonical = await promisify(sftp.realpath.bind(sftp))(root);
      const parts = file.split('/');
      let target = canonical;
      for (let i = 0; i < parts.length; i++) {
        target = joinRepositoryPath(target, parts[i]);
        let stat;
        try {
          stat = await promisify(sftp.lstat.bind(sftp))(target);
        } catch (error) {
          if (missing(error)) return null;
          throw error;
        }
        if (stat.isSymbolicLink()) throw new Unsupported('符号链接路径请使用整文件操作。');
        if (i < parts.length - 1) {
          if (!stat.isDirectory()) throw stale();
          const nested = await promisify(sftp.lstat.bind(sftp))(
            joinRepositoryPath(target, '.git'),
          ).then(
            () => true,
            (error) => {
              if (missing(error)) return false;
              throw error;
            },
          );
          if (nested) throw new Unsupported('请打开目标文件所在的嵌套仓库后操作。');
          continue;
        }
        if (!stat.isFile()) throw new Unsupported('仅普通文件支持按块或按行操作。');
        if (stat.size > MAX_BYTES) throw new Unsupported('文件超过 2 MiB，请使用整文件操作。');
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of readSftpChunks(sftp, target)) {
          this.connection.signal?.throwIfAborted();
          length += chunk.length;
          if (length > MAX_BYTES) throw new Unsupported('文件超过 2 MiB，请使用整文件操作。');
          chunks.push(chunk);
        }
        return {
          text: this.decode(Buffer.concat(chunks)),
          mode: stat.mode & 0o111 ? '100755' : '100644',
        };
      }
      throw stale();
    });
  }
  private async snapshot(root: string, file: string) {
    validateRepositoryPath(root, file);
    if ((await this.git(root, ['rev-parse', '--show-prefix'])).trim())
      throw new Unsupported('请从仓库根目录操作。');
    const index = await this.git(root, ['ls-files', '--stage', '-z', '--', file]);
    const entries = index.split('\0').filter(Boolean);
    if (entries.some((entry) => entry.slice(entry.indexOf('\t') + 1) !== file))
      throw new Unsupported('请选择单个文件。');
    if (entries.some((entry) => !/^\d+ [a-f0-9]+ 0\t/.test(entry)))
      throw new Unsupported('请先解决此文件的合并冲突。');
    const head = await runGit(this.connection, root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (head.exitCode !== 0 && head.exitCode !== 1) throw stale();
    const tree =
      head.exitCode === 0 ? await this.git(root, ['ls-tree', '-z', 'HEAD', '--', file]) : '';
    if (tree && tree.slice(tree.indexOf('\t') + 1).replace(/\0$/, '') !== file)
      throw new Unsupported('请选择单个文件。');
    if (!index && !tree) throw new Unsupported('未跟踪新文件请先使用整文件暂存。');
    // Custom filters and alternate encodings cannot be faithfully reconstructed
    // from a text diff. Refuse them instead of bypassing their clean conversion.
    const attributes = await this.git(root, [
      'check-attr',
      '-z',
      'filter',
      'working-tree-encoding',
      'ident',
      '--',
      file,
    ]);
    const attr = attributes.split('\0');
    for (let i = 2; i < attr.length; i += 3)
      if (!['unspecified', 'unset'].includes(attr[i]))
        throw new Unsupported('此文件使用内容过滤器或编码转换，请使用整文件操作。');
    const indexed = entries[0] ? entries[0].replace(/^(\d+) ([a-f0-9]+) 0\t/, '$1 blob $2\t') : '';
    const before = await this.blob(root, tree);
    const cached = await this.blob(root, indexed);
    const working = await this.worktree(root, file);
    return { head: head.stdout, index, tree, attributes, before, cached, working };
  }
  private async read(root: string, file: string, staged: boolean) {
    const state = await this.snapshot(root, file);
    const diff = await this.git(root, [
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--full-index',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--unified=3',
      '--inter-hunk-context=0',
      '--diff-algorithm=myers',
      '--no-indent-heuristic',
      ...(staged ? ['--cached'] : []),
      '--',
      file,
    ]);
    if (diff.split('\n').length > 10_000)
      throw new Unsupported('差异超过 10,000 行，请使用整文件操作。');
    const hunks = parsePatchHunks(diff);
    const after = await this.snapshot(root, file);
    if (hash(state) !== hash(after)) throw stale();
    if (!hunks.length) throw new Unsupported('没有可按块或按行操作的文本改动。');
    return { state, diff, hunks, revision: hash([root, file, staged, state, diff]) };
  }
  async preview(root: string, file: string, staged: boolean): Promise<PartialDiffPreview> {
    try {
      const { diff, revision } = await this.read(root, file, staged);
      return { diff, revision };
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error;
      return {
        diff: await new GitCommands(this.connection).diff(root, { file, staged }),
        unavailableReason: error.message,
      };
    }
  }
  async apply(root: string, request: PartialDiffRequest) {
    if (
      !request ||
      !['stage', 'unstage', 'discard'].includes(request.action) ||
      typeof request.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(request.revision)
    )
      throw new PartialChangesError('无效的部分改动请求，请刷新后重试。');
    if (request.action === 'discard' && request.confirmed !== true)
      throw new PartialChangesError('请先确认放弃所选改动。');
    const staged = request.action === 'unstage';
    let current;
    try {
      current = await this.read(root, request.file, staged);
    } catch (error) {
      if (error instanceof Unsupported) throw stale();
      throw error;
    }
    if (current.revision !== request.revision) throw stale();
    const { hunks, state } = current;
    const selection = request.selection;
    const byHunk = Array.isArray(selection?.hunks);
    const ids = byHunk ? selection.hunks : selection?.lines;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 10_000 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 0) ||
      new Set(ids).size !== ids.length ||
      (byHunk ? selection.lines !== undefined : selection?.hunks !== undefined)
    )
      throw new PartialChangesError('请选择有效的改动块或行。');
    const changeRows = hunks.flatMap((hunk) => hunk.rows.filter((row) => row.kind !== 'context'));
    const allowed = new Set(
      byHunk ? hunks.map((hunk) => hunk.index) : changeRows.map((row) => row.index),
    );
    if (ids.some((id) => !allowed.has(id)))
      throw new PartialChangesError('选择包含无效的改动块或行。');
    const selected = new Set(
      byHunk
        ? hunks
            .filter((hunk) => ids.includes(hunk.index))
            .flatMap((hunk) =>
              hunk.rows.filter((row) => row.kind !== 'context').map((row) => row.index),
            )
        : ids,
    );
    const reverse = request.action !== 'stage';
    const base = request.action === 'discard' ? state.working : state.cached;
    const destination = staged
      ? state.before
      : request.action === 'stage'
        ? state.working
        : state.cached;
    const text = selectedContent(base?.text ?? '', hunks, selected, reverse);
    const result =
      !text && !destination ? null : { text, mode: base?.mode ?? destination?.mode ?? '100644' };
    const patch = fullPatch(request.file, base, result);
    const args = [
      'apply',
      '--whitespace=nowarn',
      '--unidiff-zero',
      ...(request.action === 'discard' ? [] : ['--cached']),
    ];
    await this.git(root, [...args, '--check', '-'], { stdin: patch });
    // Re-read after Git's applicability check, including worktree bytes even for
    // unstage. A stale UI must never silently act on a newer external edit.
    if (hash(await this.snapshot(root, request.file)) !== hash(state)) throw stale();
    await this.git(root, [...args, '-'], { stdin: patch });
    return { success: true as const };
  }
}
