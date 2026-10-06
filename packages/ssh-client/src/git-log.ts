import { runGit } from './repository-transport';
import type { RepositoryTransport } from './repository-transport';
import { createHash } from 'node:crypto';
import type { CommitReference, GraphCommit, LogOptions, LogPage } from '@alune/shared';

export class GitLogChangedError extends Error {
  constructor() {
    super('仓库历史已变化，请刷新提交历史后继续加载。');
  }
}
export class GitLogOptionsError extends Error {}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '')
    throw new GitLogOptionsError('无效的历史分页参数。');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new GitLogOptionsError('无效的历史分页参数。');
  return number;
}

export async function readLog(
  connection: RepositoryTransport,
  repoPath: string,
  options: LogOptions = {},
): Promise<LogPage> {
  const count = integer(options.count, 50, 1, 200);
  const skip = integer(options.skip, 0, 0, Number.MAX_SAFE_INTEGER);
  for (const value of [
    options.branch,
    options.file,
    options.author,
    options.search,
    options.revision,
  ]) {
    if (value !== undefined && (typeof value !== 'string' || value.includes('\0')))
      throw new GitLogOptionsError('无效的历史查询参数。');
  }
  // Seconds after 1970 and before year 10000; Git reads `@0` as no date at all.
  const since = options.since === undefined ? 0 : integer(options.since, 0, 1, 253402300799);
  const until = options.until === undefined ? 0 : integer(options.until, 0, 1, 253402300799);
  if (since && until && since > until) throw new GitLogOptionsError('开始时间不能晚于结束时间。');
  const flag = options.follow as unknown;
  if (![undefined, true, false, 'true', 'false'].includes(flag as any))
    throw new GitLogOptionsError('无效的历史查询参数。');
  const follow = flag === true || flag === 'true';
  if (follow && !options.file) throw new GitLogOptionsError('跟踪重命名需要指定单个文件。');
  if (skip && !options.revision) throw new GitLogOptionsError('加载下一页需要历史版本，请先刷新。');

  const run = (args: string[]) => runGit(connection, repoPath, args);
  const checked = async (args: string[]) => {
    const result = await run(args);
    if (result.exitCode !== 0) throw new Error('无法读取提交历史：' + result.stderr);
    return result.stdout;
  };
  const snapshot = async () => {
    const [refs, head, symbolic, shallowText] = await Promise.all([
      checked([
        'for-each-ref',
        '--sort=refname',
        '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(symref)%00%(*objecttype)',
      ]),
      run(['rev-parse', '--verify', '--quiet', 'HEAD']),
      run(['symbolic-ref', '--quiet', 'HEAD']),
      checked(['rev-parse', '--is-shallow-repository']),
    ]);
    if (head.exitCode !== 0 && head.exitCode !== 1)
      throw new Error('无法读取 HEAD：' + head.stderr);
    if (symbolic.exitCode !== 0 && symbolic.exitCode !== 1)
      throw new Error('无法读取 HEAD 引用：' + symbolic.stderr);
    const headHash = head.stdout.trim();
    const headRef = symbolic.stdout.trim();
    const shallow = shallowText.trim() === 'true';
    // Deepening changes the shallow roots even when every branch tip stays put.
    const boundary = shallow
      ? await checked(['rev-list', '--all', '--max-parents=0', ...(headHash ? [headHash] : [])])
      : '';
    const revision = createHash('sha256')
      .update(
        JSON.stringify([
          refs,
          headHash,
          headRef,
          shallow,
          boundary,
          options.branch || '',
          options.file || '',
          options.author || '',
          options.search || '',
          since,
          until,
          follow,
        ]),
      )
      .digest('hex');
    return { refs, headHash, headRef, shallow, revision };
  };

  const before = await snapshot();
  if (options.revision && options.revision !== before.revision) throw new GitLogChangedError();
  const references = new Map<string, CommitReference[]>();
  const add = (hash: string, reference: CommitReference) => {
    references.set(hash, [...(references.get(hash) || []), reference]);
  };
  for (const line of before.refs.split('\n').filter(Boolean)) {
    const [fullName, hash, peeled, symbolic, peeledType] = line.split('\0');
    if (symbolic) continue; // Remote HEAD aliases repeat their target branch.
    const kind = fullName.startsWith('refs/heads/')
      ? 'local'
      : fullName.startsWith('refs/remotes/')
        ? 'remote'
        : fullName.startsWith('refs/tags/')
          ? 'tag'
          : 'other';
    const target =
      peeledType === 'tag'
        ? (await checked(['rev-parse', '--verify', '--end-of-options', fullName + '^{}'])).trim()
        : peeled || hash;
    add(target, {
      name: fullName.replace(/^refs\/(heads|remotes|tags)\//, ''),
      fullName,
      kind,
      ...(fullName === before.headRef ? { current: true } : {}),
    });
  }
  if (before.headHash && !before.headRef)
    add(before.headHash, { name: 'HEAD', fullName: 'HEAD', kind: 'head', current: true });

  let revisions = ['--all', ...(before.headHash ? [before.headHash] : [])];
  if (options.branch) {
    const hash = await checked([
      'rev-parse',
      '--verify',
      '--end-of-options',
      options.branch + '^{commit}',
    ]);
    revisions = [hash.trim()];
  }
  const filtered = !!(options.search || options.author || since || until);
  const paths = ['--', ...(options.file ? [options.file] : [])];
  // Followed history appends the full message and committer date, then a status.
  const fieldCount = follow ? 9 : 7;
  const format =
    '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P' + (follow ? '%x00%B%x00%cI' : '');
  const parse = (output: string) => {
    const fields = output.split('\0');
    if (fields.at(-1) === '') fields.pop();
    const commits: (GraphCommit & { body?: string; committed?: number })[] = [];
    let i = 0;
    while (i < fields.length) {
      if (i + fieldCount > fields.length) throw new Error('提交历史格式不完整，请重试。');
      const [hash, shortHash, message, author, email, date, parents, body, committed] =
        fields.slice(i, i + fieldCount);
      i += fieldCount;
      let path: string | undefined;
      let oldPath: string | undefined;
      // With `-z --name-status` each status follows the format after a newline.
      if (follow && fields[i]?.startsWith('\n')) {
        const status = fields[i++].slice(1);
        if (/^[RC]/.test(status)) oldPath = fields[i++];
        path = fields[i++];
        if (path === undefined) throw new Error('提交历史格式不完整，请重试。');
      }
      const refs = references.get(hash) || [];
      commits.push({
        hash,
        shortHash,
        message,
        author,
        email,
        date: new Date(date),
        parents: parents ? parents.split(' ') : [],
        references: refs,
        refs: refs.map((ref) =>
          ref.kind === 'tag'
            ? 'tag: ' + ref.name
            : ref.current && ref.kind === 'local'
              ? 'HEAD -> ' + ref.name
              : ref.name,
        ),
        ...(path !== undefined ? { path } : {}),
        ...(oldPath !== undefined && oldPath !== path ? { oldPath } : {}),
        ...(follow ? { body, committed: Date.parse(committed) / 1000 } : {}),
      });
    }
    return commits;
  };
  const log = (args: string[]) =>
    checked(['log', '--no-color', '--no-show-signature', '--no-decorate', '-z', format, ...args]);
  const search = options.search?.toLowerCase();
  const hashLike = !!search && /^[0-9a-f]{4,40}$/.test(search);

  let commits: GraphCommit[];
  let hasMore: boolean;
  let nextSkip: number;
  if (follow) {
    // Git stops following a rename made in a commit it filters out or skips, so
    // walk the file's whole history and filter here with `-i -F` semantics.
    const output = await log([
      '--topo-order',
      '--name-status',
      '--follow',
      ...(filtered ? [] : ['--max-count=' + (skip + count + 1)]),
      ...revisions,
      ...paths,
    ]);
    const author = options.author?.toLowerCase();
    const matches = parse(output).filter(
      (commit) =>
        (!search ||
          commit.body!.toLowerCase().includes(search) ||
          (hashLike && commit.hash.startsWith(search))) &&
        (!author || (commit.author + ' <' + commit.email + '>').toLowerCase().includes(author)) &&
        (!since || commit.committed! >= since) &&
        (!until || commit.committed! <= until),
    );
    commits = matches
      .slice(skip, skip + count)
      .map(({ body: _body, committed: _committed, ...commit }) => commit);
    hasMore = matches.length > skip + count;
    nextSkip = skip + commits.length;
  } else {
    const filters = [
      ...(options.author || options.search ? ['--regexp-ignore-case', '--fixed-strings'] : []),
      ...(options.author ? ['--author=' + options.author] : []),
      ...(since ? ['--since=@' + since] : []),
      ...(until ? ['--until=@' + until] : []),
      // Parent rewriting keeps the commits a pathspec leaves connected in the graph.
      ...(options.file ? ['--parents'] : []),
    ];
    // A hash prefix finds its commit when that commit also passes the other
    // filters. It leads the first page and is dropped from the message matches.
    let hashMatch: GraphCommit | undefined;
    if (hashLike) {
      const resolved = await run([
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        search + '^{commit}',
      ]);
      const hash = resolved.stdout.trim();
      if (
        resolved.exitCode === 0 &&
        hash.startsWith(search!) &&
        (!options.branch ||
          (await run(['merge-base', '--is-ancestor', hash, revisions[0]])).exitCode === 0)
      )
        hashMatch = parse(await log(['--no-walk', ...filters, hash, ...paths]))[0];
    }
    const lead = hashMatch && !skip ? [hashMatch] : [];
    // Keep at least one message match on the first page so `nextSkip` advances.
    const limit = Math.max(1, count - lead.length);
    const found = parse(
      await log([
        '--topo-order',
        '--max-count=' + (limit + 1),
        '--skip=' + skip,
        ...filters,
        ...(options.search ? ['--grep=' + options.search] : []),
        ...revisions,
        ...paths,
      ]),
    );
    const consumed = Math.min(limit, found.length);
    commits = [
      ...lead,
      ...found.slice(0, consumed).filter((commit) => commit.hash !== hashMatch?.hash),
    ];
    hasMore = found.length > limit;
    nextSkip = skip + consumed;
  }
  const after = await snapshot();
  if (before.revision !== after.revision) throw new GitLogChangedError();
  return {
    commits,
    hasMore,
    nextSkip,
    revision: before.revision,
    shallow: before.shallow,
  };
}
