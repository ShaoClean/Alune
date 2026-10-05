import { createHash } from 'node:crypto';
import { BLAME_MAX_BYTES, BLAME_MAX_LINES, BLAME_TIMEOUT_MS } from '@alune/shared';
import type {
  BlameOptions,
  BlameResult,
  BlameLine,
  BlameCommit,
  BlameCommitDetail,
} from '@alune/shared';
import { runGit } from './repository-transport';
import type { RepositoryTransport } from './repository-transport';
import {
  RepositoryFiles,
  RepositoryFileError,
  validateRepositoryPath,
  decodeTextPreview,
} from './repository-files';

const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const limitMessage = `文件超过逐行追溯上限（${BLAME_MAX_BYTES / 1024} KB 或 ${BLAME_MAX_LINES} 行），请在终端使用 git blame。`;
const normalized = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '');

// Git C-quotes control characters and (depending on core.quotePath) UTF-8 bytes.
function unquote(path: string): string {
  if (!path.startsWith('"')) return path;
  const bytes: number[] = [];
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '\\': 92,
    '"': 34,
  };
  const inner = path.slice(1, -1);
  for (let i = 0; i < inner.length;) {
    if (inner[i] === '\\') {
      const octal = inner.slice(i + 1).match(/^[0-7]{1,3}/)?.[0];
      if (octal) {
        bytes.push(parseInt(octal, 8));
        i += 1 + octal.length;
      } else {
        bytes.push(escapes[inner[i + 1]] ?? inner.charCodeAt(i + 1));
        i += 2;
      }
    } else {
      const point = String.fromCodePoint(inner.codePointAt(i)!);
      bytes.push(...Buffer.from(point));
      i += point.length;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

export function parseBlame(output: string) {
  const lines: BlameLine[] = [];
  const commits: Record<string, BlameCommit> = {};
  const content: string[] = [];
  let current: BlameLine | undefined;
  let metadata: Record<string, string> = {};
  for (const row of output.split('\n')) {
    const header = row.match(/^([a-f0-9]{40}|[a-f0-9]{64}) (\d+) (\d+)(?: \d+)?$/);
    if (header) {
      current = {
        hash: header[1],
        originalLine: Number(header[2]),
        line: Number(header[3]),
        path: '',
        uncommitted: /^0+$/.test(header[1]),
      };
      metadata = {};
    } else if (current && row.startsWith('\t')) {
      if (current.line !== lines.length + 1 || !current.path)
        throw new RepositoryFileError('追溯行号不完整，请刷新后重试。');
      commits[current.hash] = {
        hash: current.hash,
        author: current.uncommitted ? '未提交的改动' : metadata.author,
        email: (metadata['author-mail'] ?? '').replace(/^<|>$/g, ''),
        date: new Date(Number(metadata['author-time']) * 1000).toISOString(),
        summary: current.uncommitted ? '未提交的改动' : metadata.summary,
      };
      lines.push(current);
      content.push(row.slice(1));
      current = undefined;
    } else if (current) {
      const space = row.indexOf(' ');
      const key = space < 0 ? row : row.slice(0, space);
      const value = space < 0 ? '' : row.slice(space + 1);
      metadata[key] = value;
      if (key === 'filename') current.path = unquote(value);
      if (key === 'previous') {
        const split = value.indexOf(' ');
        current.previous = { hash: value.slice(0, split), path: unquote(value.slice(split + 1)) };
      }
      if (key === 'ignored') current.ignored = true;
      if (key === 'unblamable') current.unblamable = true;
    }
  }
  if (current) throw new RepositoryFileError('追溯结果不完整，请重试。');
  return { lines, commits, text: content.join('\n') };
}

// Map the selected line through a zero-context diff. Added/replaced lines have
// no exact predecessor: show the nearest parent location with an explicit note.
export function parentLine(diff: string, line: number): { line: number; exact: boolean } {
  let offset = 0;
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const oldStart = Number(match[1]),
      oldCount = Number(match[2] ?? 1);
    const newStart = Number(match[3]),
      newCount = Number(match[4] ?? 1);
    const oldFirst = oldStart + (oldCount === 0 ? 1 : 0);
    const newFirst = newStart + (newCount === 0 ? 1 : 0);
    if (line < newFirst) break;
    if (newCount && line < newStart + newCount)
      return {
        line: Math.max(1, oldStart + Math.min(line - newStart, Math.max(0, oldCount - 1))),
        exact: false,
      };
    offset = oldFirst + oldCount - newFirst - newCount;
  }
  return { line: Math.max(1, line + offset), exact: true };
}

export class GitBlame {
  constructor(private readonly connection: RepositoryTransport) {}

  private async deadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new RepositoryFileError('逐行追溯超时，请稍后重试或在终端使用 git blame。');
        controller.abort(error);
        reject(error);
      }, BLAME_TIMEOUT_MS);
    });
    try {
      return await Promise.race([operation(combined), timeout]);
    } finally {
      clearTimeout(timer!);
      controller.abort();
    }
  }

  private async git(repo: string, args: string[], signal: AbortSignal, binary = false) {
    const result = await runGit(this.connection, repo, args, signal, {
      maxOutputBytes: binary ? BLAME_MAX_BYTES : 8 * 1024 * 1024,
      binary,
    });
    if (result.exitCode !== 0)
      throw new RepositoryFileError(`无法读取追溯信息：${result.stderr.trim()}`);
    return result;
  }

  async commit(repo: string, hash: string, signal?: AbortSignal): Promise<BlameCommitDetail> {
    if (!HASH.test(hash)) throw new RepositoryFileError('无效的提交哈希。');
    return this.deadline(async (signal) => {
      const { stdout } = await this.git(
        repo,
        [
          'show',
          '--no-patch',
          '--no-show-signature',
          '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%B',
          `${hash}^{commit}`,
          '--',
        ],
        signal,
      );
      const [fullHash, shortHash, author, email, date, parents, ...body] = stdout.split('\0');
      const message = body.join('\0').trimEnd();
      return {
        hash: fullHash,
        shortHash,
        author,
        email,
        date: new Date(date),
        parents: parents ? parents.split(' ') : [],
        references: [],
        refs: [],
        message: message.split('\n')[0],
        body: message,
      };
    }, signal);
  }

  async read(repo: string, options: BlameOptions, signal?: AbortSignal): Promise<BlameResult> {
    validateRepositoryPath(repo, options.path);
    if (options.revision !== undefined && !HASH.test(options.revision))
      throw new RepositoryFileError('无效的追溯版本。');
    if (
      options.previousLine !== undefined &&
      (!Number.isSafeInteger(options.previousLine) ||
        options.previousLine < 1 ||
        options.previousLine > BLAME_MAX_LINES)
    )
      throw new RepositoryFileError('无效的追溯行号。');
    return this.deadline(async (signal) => {
      const current = await this.readVersion(repo, options, signal);
      if (!options.previousLine || current.kind !== 'ready') return current;
      if (options.expectedVersion && options.expectedVersion !== current.version)
        throw new RepositoryFileError('文件追溯已变化，请返回工作区并刷新后重试。');
      const selected = current.lines[options.previousLine - 1];
      if (!selected) throw new RepositoryFileError('此行已变化，请刷新后重试。');
      if (!selected.previous)
        throw new RepositoryFileError('此行没有可追溯的父版本（首次提交、新文件或浅克隆边界）。');
      const previous = selected.previous;
      validateRepositoryPath(repo, previous.path);
      validateRepositoryPath(repo, selected.path);
      const result = await this.readVersion(
        repo,
        { ...options, path: previous.path, revision: previous.hash },
        signal,
      );
      if (result.kind !== 'ready') return result;
      const diff = await this.git(
        repo,
        [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '--unified=0',
          '--inter-hunk-context=0',
          ...(selected.uncommitted
            ? [previous.hash, '--', options.path]
            : [`${previous.hash}:${previous.path}`, `${selected.hash}:${selected.path}`, '--']),
        ],
        signal,
      );
      const focus = parentLine(
        diff.stdout,
        selected.uncommitted ? selected.line : selected.originalLine,
      );
      return {
        ...result,
        focusLine: Math.min(Math.max(1, result.lines.length), focus.line),
        notice: focus.exact ? undefined : '该行在所选提交中新增或改写，已定位到父版本的相邻位置。',
      };
    }, signal);
  }

  private async readVersion(
    repo: string,
    options: BlameOptions,
    signal: AbortSignal,
  ): Promise<BlameResult> {
    const { path, revision } = options;
    const unavailable = (message: string): BlameResult => ({
      path,
      revision,
      kind: 'unavailable',
      message,
    });
    const files = new RepositoryFiles(this.connection);
    let content: string;
    if (revision) {
      const tree = await this.git(repo, ['ls-tree', '-z', revision, '--', path], signal);
      if (!/^100(644|755) blob /.test(tree.stdout))
        return unavailable('此版本没有可追溯的普通文件。');
      const spec = `${revision}:${path}`;
      const size = await this.git(repo, ['cat-file', '-s', spec], signal);
      if (Number(size.stdout) > BLAME_MAX_BYTES) return unavailable(limitMessage);
      const bytes = await this.git(repo, ['cat-file', 'blob', spec], signal, true);
      const decoded = decodeTextPreview(bytes.stdoutBytes!);
      if (typeof decoded === 'string' || decoded.encoding !== 'utf-8')
        return unavailable('二进制文件及非 UTF-8 文件暂不支持逐行追溯。');
      content = decoded.content;
    } else {
      const preview = await files.read(repo, path);
      if (preview.kind === 'too-large' || ('size' in preview && preview.size > BLAME_MAX_BYTES))
        return unavailable(limitMessage);
      if (preview.kind !== 'text' || preview.encoding !== 'utf-8')
        return unavailable('二进制文件、图片、符号链接及非 UTF-8 文件暂不支持逐行追溯。');
      content = preview.content;
    }
    if (!content) return unavailable('空文件没有可追溯的行。');
    if (normalized(content).split('\n').length > BLAME_MAX_LINES) return unavailable(limitMessage);
    if (content.replace(/\r\n/g, '').includes('\r'))
      return unavailable('仅使用 CR 换行的文件暂不支持逐行追溯。');
    signal.throwIfAborted();
    let ignoreRevsApplied = false;
    if (options.useIgnoreRevs !== false) {
      try {
        const ignore = await files.read(repo, '.git-blame-ignore-revs');
        if (ignore.kind !== 'text' || ignore.encoding !== 'utf-8')
          throw new RepositoryFileError(
            '.git-blame-ignore-revs 必须是仓库内的 UTF-8 普通文本文件。',
          );
        ignoreRevsApplied = true;
      } catch (error) {
        if (!(error instanceof RepositoryFileError && error.statusCode === 404)) throw error;
      }
    }
    if (!revision) {
      const head = await runGit(
        this.connection,
        repo,
        ['rev-parse', '--verify', '--quiet', 'HEAD'],
        signal,
      );
      const tracked = await this.git(repo, ['ls-files', '-z', '--', path], signal);
      if (head.exitCode === 1 || !tracked.stdout) {
        const hash = '0'.repeat(40);
        return {
          path,
          kind: 'ready',
          version: createHash('sha256').update(content).digest('hex'),
          content,
          ignoreRevsApplied: false,
          commits: {
            [hash]: { hash, author: '未提交的改动', email: '', date: '', summary: '未提交的改动' },
          },
          lines: normalized(content)
            .split('\n')
            .map((_, index) => ({
              line: index + 1,
              originalLine: index + 1,
              hash,
              path,
              uncommitted: true,
            })),
          notice: '新文件尚无提交记录，所有行均为未提交的改动。',
        };
      }
      if (head.exitCode !== 0) throw new RepositoryFileError(`无法读取 HEAD：${head.stderr}`);
    }
    const { stdout } = await this.git(
      repo,
      [
        '-c',
        'core.quotePath=false',
        '-c',
        'blame.markIgnoredLines=true',
        '-c',
        'blame.markUnblamableLines=true',
        'blame',
        '--line-porcelain',
        '--no-textconv',
        '--encoding=UTF-8',
        '--ignore-revs-file',
        '',
        ...(options.ignoreWhitespace ? ['-w'] : []),
        ...(ignoreRevsApplied ? ['--ignore-revs-file', '.git-blame-ignore-revs'] : []),
        ...(revision ? [revision] : []),
        '--',
        path,
      ],
      signal,
    );
    const parsed = parseBlame(stdout);
    if (normalized(parsed.text + '\n') !== normalized(content))
      throw new RepositoryFileError('文件在读取期间发生变化，请刷新后重试。');
    return {
      path,
      revision,
      kind: 'ready',
      content,
      version: createHash('sha256')
        .update(JSON.stringify([content, parsed.lines]))
        .digest('hex'),
      lines: parsed.lines,
      commits: parsed.commits,
      ignoreRevsApplied,
    };
  }
}
