import type { PartialDiffPreview } from '@alune/domain';
import { parsePatchHunks } from '@alune/domain';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { GitWorktrees, worktreePathKey } from './worktrees';
import { GitReads as GitCommands } from './git-commands';
import { validateRepositoryPath } from './repository-files';
import { joinRepositoryPath } from './repository-path';
import type { CommandOptions, RepositoryTransport } from './repository-transport';
import { runGit } from './repository-transport';
import { readSftpChunks } from './sftp-file';

const MAX_BYTES = 2 * 1024 * 1024;
export const partialHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
export const partialStale = () =>
  new PartialChangesError('文件、暂存区或 HEAD 已变化，请刷新差异后重新选择。', 409);
export class PartialUnsupported extends Error {}
type FileContent = { text: string; mode: string } | null;

export class PartialReads {
  constructor(protected connection: RepositoryTransport) {}
  protected async git(root: string, args: string[], options?: CommandOptions) {
    const result = await runGit(this.connection, root, args, undefined, {
      maxOutputBytes: 8 * MAX_BYTES,
      strictUtf8: true,
      ...options,
    });
    if (result.exitCode !== 0)
      throw new PartialChangesError(result.stderr.trim() || '无法读取 Git 状态。');
    return result.stdout;
  }
  protected decode(bytes: Buffer): string {
    if (bytes.length > MAX_BYTES)
      throw new PartialUnsupported('文件超过 2 MiB，请使用整文件操作。');
    if (bytes.includes(0)) throw new PartialUnsupported('二进制文件不支持按块或按行操作。');
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new PartialUnsupported('仅 UTF-8 文本支持按块或按行操作。');
    }
  }
  protected async blob(
    root: string,
    entry: string,
    blobs: Map<string, string>,
  ): Promise<FileContent> {
    if (!entry) return null;
    const [mode, , oid] = entry.split(/[ \t]/);
    if (!/^100(644|755)$/.test(mode))
      throw new PartialUnsupported('符号链接和子模块请使用整文件操作。');
    const cached = blobs.get(oid);
    if (cached !== undefined) return { text: cached, mode };
    const size = Number(await this.git(root, ['cat-file', '-s', oid]));
    if (size > MAX_BYTES) throw new PartialUnsupported('文件超过 2 MiB，请使用整文件操作。');
    const result = await runGit(this.connection, root, ['cat-file', 'blob', oid], undefined, {
      binary: true,
      maxOutputBytes: MAX_BYTES,
    });
    if (result.exitCode !== 0 || !result.stdoutBytes) throw partialStale();
    const text = this.decode(result.stdoutBytes);
    blobs.set(oid, text);
    return { text, mode };
  }
  protected async worktree(root: string, file: string): Promise<FileContent> {
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
        if (stat.isSymbolicLink()) throw new PartialUnsupported('符号链接路径请使用整文件操作。');
        if (i < parts.length - 1) {
          if (!stat.isDirectory()) throw partialStale();
          const nested = await promisify(sftp.lstat.bind(sftp))(
            joinRepositoryPath(target, '.git'),
          ).then(
            () => true,
            (error) => {
              if (missing(error)) return false;
              throw error;
            },
          );
          if (nested) throw new PartialUnsupported('请打开目标文件所在的嵌套仓库后操作。');
          continue;
        }
        if (!stat.isFile()) throw new PartialUnsupported('仅普通文件支持按块或按行操作。');
        if (stat.size > MAX_BYTES)
          throw new PartialUnsupported('文件超过 2 MiB，请使用整文件操作。');
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of readSftpChunks(sftp, target)) {
          this.connection.signal?.throwIfAborted();
          length += chunk.length;
          if (length > MAX_BYTES)
            throw new PartialUnsupported('文件超过 2 MiB，请使用整文件操作。');
          chunks.push(chunk);
        }
        return {
          text: this.decode(Buffer.concat(chunks)),
          mode: stat.mode & 0o111 ? '100755' : '100644',
        };
      }
      throw partialStale();
    });
  }
  protected async snapshot(root: string, file: string, blobs = new Map<string, string>()) {
    validateRepositoryPath(root, file);
    if ((await this.git(root, ['rev-parse', '--show-prefix'])).trim())
      throw new PartialUnsupported('请从仓库根目录操作。');
    const index = await this.git(root, ['ls-files', '--stage', '-z', '--', file]);
    const entries = index.split('\0').filter(Boolean);
    if (entries.some((entry) => entry.slice(entry.indexOf('\t') + 1) !== file))
      throw new PartialUnsupported('请选择单个文件。');
    if (entries.some((entry) => !/^\d+ [a-f0-9]+ 0\t/.test(entry)))
      throw new PartialUnsupported('请先解决此文件的合并冲突。');
    const head = await runGit(this.connection, root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    if (head.exitCode !== 0 && head.exitCode !== 1) throw partialStale();
    const tree =
      head.exitCode === 0 ? await this.git(root, ['ls-tree', '-z', 'HEAD', '--', file]) : '';
    if (tree && tree.slice(tree.indexOf('\t') + 1).replace(/\0$/, '') !== file)
      throw new PartialUnsupported('请选择单个文件。');
    if (!index && !tree) throw new PartialUnsupported('未跟踪新文件请先使用整文件暂存。');
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
        throw new PartialUnsupported('此文件使用内容过滤器或编码转换，请使用整文件操作。');
    const indexed = entries[0] ? entries[0].replace(/^(\d+) ([a-f0-9]+) 0\t/, '$1 blob $2\t') : '';
    const before = await this.blob(root, tree, blobs);
    const cached = await this.blob(root, indexed, blobs);
    const working = await this.worktree(root, file);
    return { head: head.stdout, index, tree, attributes, before, cached, working };
  }
  protected async read(root: string, file: string, staged: boolean, fullFile = false) {
    // Objects are immutable by OID. Only reuse their bytes within this read;
    // HEAD, index entries, attributes and worktree bytes are still read twice.
    const blobs = new Map<string, string>();
    const state = await this.snapshot(root, file, blobs);
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
      fullFile ? '--unified=2147483647' : '--unified=3',
      '--inter-hunk-context=0',
      '--diff-algorithm=myers',
      '--no-indent-heuristic',
      ...(staged ? ['--cached'] : []),
      '--',
      file,
    ]);
    if (diff.split('\n').length > 10_000)
      throw new PartialUnsupported('差异超过 10,000 行，请使用整文件操作。');
    const hunks = parsePatchHunks(diff);
    const after = await this.snapshot(root, file, blobs);
    if (partialHash(state) !== partialHash(after)) throw partialStale();
    if (!hunks.length) throw new PartialUnsupported('没有可按块或按行操作的文本改动。');
    // Legacy UI and Agent may spell the same native path differently (including
    // Windows 8.3 names and slash styles). Bind the token to the canonical root.
    const identity = worktreePathKey(await new GitWorktrees(this.connection).canonicalPath(root));
    return { state, diff, hunks, revision: partialHash([identity, file, staged, state, diff]) };
  }
  async preview(
    root: string,
    file: string,
    staged: boolean,
    fullFile = false,
  ): Promise<PartialDiffPreview> {
    try {
      const { diff, revision } = await this.read(root, file, staged, fullFile);
      return { diff, revision };
    } catch (error) {
      if (!(error instanceof PartialUnsupported)) throw error;
      return {
        diff: await new GitCommands(this.connection).diff(root, { file, staged, fullFile }),
        unavailableReason: error.message,
      };
    }
  }
}
