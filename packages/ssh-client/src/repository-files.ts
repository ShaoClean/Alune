import { posix } from 'path';
import { promisify } from 'util';
import type { SFTPWrapper, Stats } from 'ssh2';
import {
  DIFF_IMAGE_MAX_BYTES,
  REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
  REPOSITORY_TREE_MAX_ENTRIES,
  diffImageMediaType,
} from '@alune/shared';
import type {
  RepositoryFilePreview,
  RepositoryTreeEntry,
  RepositoryTreeEntryKind,
  RepositoryTreeListing,
} from '@alune/shared';
import { SSHConnection } from './connection-manager';
import { isWindowsPath } from './git-shell';

export class RepositoryFileError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
// Parallel SFTP requests per listing; enough to hide latency without flooding the channel.
const SFTP_CONCURRENCY = 64;
// Git's own heuristic: a NUL byte near the start means binary content.
const BINARY_SNIFF_BYTES = 8000;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function kindOf(mode: number | undefined): RepositoryTreeEntryKind | undefined {
  if (typeof mode !== 'number') return undefined;
  switch (mode & S_IFMT) {
    case S_IFDIR:
      return 'directory';
    case S_IFREG:
      return 'file';
    case S_IFLNK:
      return 'symlink';
    default:
      return 'other';
  }
}

// '' is the repository root. Everything else must stay inside the worktree and
// may not reach Git's own metadata.
export function validateRepositoryPath(repoPath: string, path: string, allowRoot = false): void {
  if (typeof path !== 'string' || (!path && !allowRoot))
    throw new RepositoryFileError('请指定仓库内的相对路径。');
  if (!path) return;
  if (
    path.startsWith('/') ||
    path.includes('\0') ||
    path
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
  )
    throw new RepositoryFileError('路径必须是仓库内的相对路径，且不能访问 .git。');
  if (isWindowsPath(repoPath) && /[\\:]/.test(path))
    throw new RepositoryFileError('Windows 仓库中的路径必须使用 / 分隔，不能包含反斜杠或冒号。');
}

export function decodeTextPreview(
  bytes: Buffer,
):
  | { encoding: 'utf-8' | 'utf-16le' | 'utf-16be'; content: string }
  | 'binary'
  | 'unsupported-encoding' {
  const decode = (encoding: string, data: Uint8Array) => {
    try {
      return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      return null;
    }
  };
  // UTF-16 legitimately contains NUL bytes, so its BOM is checked before sniffing.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const content = decode('utf-16le', bytes.subarray(2));
    return content === null ? 'unsupported-encoding' : { encoding: 'utf-16le', content };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    if (swapped.length % 2) return 'unsupported-encoding';
    const content = decode('utf-16le', swapped.swap16());
    return content === null ? 'unsupported-encoding' : { encoding: 'utf-16be', content };
  }
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return 'binary';
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const content = decode('utf-8', bom ? bytes.subarray(3) : bytes);
  return content === null ? 'unsupported-encoding' : { encoding: 'utf-8', content };
}

async function eachLimit<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SFTP_CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

class PreviewLimitError extends Error {}

export class RepositoryFiles {
  constructor(private readonly connection: SSHConnection) {}

  async list(repoPath: string, dir: string): Promise<RepositoryTreeListing> {
    validateRepositoryPath(repoPath, dir, true);
    return this.sftp('目录', async (sftp) => {
      const lstat = promisify(sftp.lstat.bind(sftp));
      const target = await this.resolve(sftp, repoPath, dir, dir);
      if (dir && (await lstat(target)).isDirectory() === false)
        throw new RepositoryFileError('此路径不是目录。');
      const raw = await promisify(sftp.readdir.bind(sftp))(target);
      const entries: RepositoryTreeEntry[] = [];
      const unknown: RepositoryTreeEntry[] = [];
      for (const item of raw) {
        const name = item.filename;
        if (!name || name === '.' || name === '..' || name.toLowerCase() === '.git') continue;
        if (name.includes('/') || name.includes('\0')) continue;
        const kind = kindOf(item.attrs?.mode);
        const entry: RepositoryTreeEntry = {
          name,
          path: dir ? `${dir}/${name}` : name,
          kind: kind ?? 'other',
        };
        if (kind === 'file' && typeof item.attrs.size === 'number') entry.size = item.attrs.size;
        if (!kind) unknown.push(entry);
        entries.push(entry);
      }
      // Some servers omit attributes in directory listings.
      await eachLimit(unknown, async (entry) => {
        const stat = await lstat(posix.join(target, entry.name)).catch(() => undefined);
        entry.kind = kindOf(stat?.mode) ?? 'other';
        if (entry.kind === 'file' && typeof stat?.size === 'number') entry.size = stat.size;
      });

      const group = (entry: RepositoryTreeEntry) => (entry.kind === 'directory' ? 0 : 1);
      entries.sort(
        (a, b) =>
          group(a) - group(b) ||
          collator.compare(a.name, b.name) ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );
      const shown = entries.slice(0, REPOSITORY_TREE_MAX_ENTRIES);

      // Initialised submodules and nested repositories carry their own .git
      // (a directory or a gitlink file); they are separate repositories.
      await eachLimit(
        shown.filter((entry) => entry.kind === 'directory'),
        async (entry) => {
          const nested = await lstat(posix.join(target, entry.name, '.git')).then(
            () => true,
            () => false,
          );
          if (nested) entry.kind = 'submodule';
        },
      );
      await eachLimit(
        shown.filter((entry) => entry.kind === 'symlink'),
        async (entry) => {
          entry.target = await promisify(sftp.readlink.bind(sftp))(
            posix.join(target, entry.name),
          ).catch(() => undefined);
        },
      );
      return {
        path: dir,
        entries: shown,
        total: entries.length,
        truncated: entries.length > shown.length,
      };
    });
  }

  async read(repoPath: string, file: string): Promise<RepositoryFilePreview> {
    validateRepositoryPath(repoPath, file);
    return this.sftp('文件', async (sftp) => {
      const slash = file.lastIndexOf('/');
      const parent = await this.resolve(
        sftp,
        repoPath,
        slash < 0 ? '' : file.slice(0, slash),
        file,
      );
      const target = posix.join(parent, file.slice(slash + 1));
      const stat: Stats = await promisify(sftp.lstat.bind(sftp))(target);
      if (stat.isSymbolicLink()) {
        const link = await promisify(sftp.readlink.bind(sftp))(target);
        return { path: file, kind: 'symlink', target: link };
      }
      if (stat.isDirectory()) throw new RepositoryFileError('此路径是目录，请在目录树中展开查看。');
      if (!stat.isFile()) return { path: file, kind: 'other' };

      const mediaType = diffImageMediaType(file);
      const limit = mediaType ? DIFF_IMAGE_MAX_BYTES : REPOSITORY_TEXT_PREVIEW_MAX_BYTES;
      if (stat.size > limit) return { path: file, kind: 'too-large', size: stat.size, limit };
      let bytes: Buffer;
      try {
        bytes = await this.readCapped(sftp, target, limit);
      } catch (error) {
        // The file grew between lstat and read.
        if (error instanceof PreviewLimitError)
          return { path: file, kind: 'too-large', size: limit + 1, limit };
        throw error;
      }
      if (mediaType)
        return {
          path: file,
          kind: 'image',
          size: bytes.length,
          mediaType,
          content: bytes.toString('base64'),
        };
      const text = decodeTextPreview(bytes);
      if (text === 'binary') return { path: file, kind: 'binary', size: bytes.length };
      if (text === 'unsupported-encoding')
        return { path: file, kind: 'unsupported-encoding', size: bytes.length };
      return { path: file, kind: 'text', size: bytes.length, ...text };
    });
  }

  // Returns the absolute path of `relative`, refusing any route through a
  // symlink so that a link can never expose files outside the repository.
  private async resolve(
    sftp: SFTPWrapper,
    repoPath: string,
    relative: string,
    requested: string,
  ): Promise<string> {
    const realpath = promisify(sftp.realpath.bind(sftp));
    // SFTP resolves Windows drive paths as well as POSIX paths without shell syntax.
    const root = await realpath(repoPath);
    if (!relative) return root;
    const target = posix.join(root, relative);
    const resolved = await realpath(target);
    const same = isWindowsPath(repoPath)
      ? resolved.replace(/\\/g, '/').toLowerCase() === target.toLowerCase()
      : resolved === target;
    if (!same) throw new RepositoryFileError(`“${requested}”经过符号链接，只读浏览不会跟随链接。`);
    return target;
  }

  private async readCapped(sftp: SFTPWrapper, target: string, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let read = 0;
    for await (const chunk of sftp.createReadStream(target)) {
      read += (chunk as Buffer).length;
      if (read > limit) throw new PreviewLimitError();
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private async sftp<T>(subject: string, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    try {
      return await this.connection.withSftp(operation);
    } catch (error) {
      if (error instanceof RepositoryFileError) throw error;
      const code = (error as { code?: number | string })?.code;
      if (code === 2 || code === 'ENOENT')
        throw new RepositoryFileError(`${subject}不存在，可能已被移动或删除，请刷新后重试。`, 404);
      if (code === 3 || code === 'EACCES')
        throw new RepositoryFileError(`没有读取此${subject}的权限。`, 403);
      throw new RepositoryFileError(
        `无法读取${subject}：${error instanceof Error && error.message ? error.message : '远端文件操作失败'}`,
      );
    }
  }
}
