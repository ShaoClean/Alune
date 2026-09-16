import { createHash } from 'node:crypto';
import type { CommitReference, GraphCommit, LogOptions, LogPage } from '@remote-git/shared';
import type { SSHConnection } from './connection-manager';
import { gitFileCommand } from './git-shell';

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
  connection: SSHConnection,
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
  if (skip && !options.revision) throw new GitLogOptionsError('加载下一页需要历史版本，请先刷新。');

  const run = (args: string[]) => connection.execCommand(gitFileCommand(repoPath, args));
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
  const output = await checked([
    'log',
    '--topo-order',
    '--no-color',
    '--no-show-signature',
    '--no-decorate',
    '-z',
    '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P',
    '--max-count=' + (count + 1),
    '--skip=' + skip,
    ...(options.author ? ['--author=' + options.author] : []),
    ...(options.search ? ['--grep=' + options.search] : []),
    ...revisions,
    '--',
    ...(options.file ? [options.file] : []),
  ]);
  const after = await snapshot();
  if (before.revision !== after.revision) throw new GitLogChangedError();
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 7) throw new Error('提交历史格式不完整，请重试。');
  const commits: GraphCommit[] = [];
  for (let i = 0; i < fields.length; i += 7) {
    const [hash, shortHash, message, author, email, date, parents] = fields.slice(i, i + 7);
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
    });
  }
  return {
    commits: commits.slice(0, count),
    hasMore: commits.length > count,
    nextSkip: skip + Math.min(count, commits.length),
    revision: before.revision,
    shallow: before.shallow,
  };
}
