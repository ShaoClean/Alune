import { runGit, type RepositoryTransport } from './repository-transport';

export async function readTrackingBranch(connection: RepositoryTransport, path: string) {
  const ref = await read(connection, path, ['symbolic-ref', '--quiet', 'HEAD'], true);
  if (!ref.startsWith('refs/heads/')) return null;
  const row = await read(connection, path, [
    'for-each-ref',
    '--count=1',
    '--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:short)',
    ref,
  ]);
  const [name, head, upstreamRef, upstream] = row.split('\0');
  if (name !== ref || !head || !upstreamRef || !upstream) return null;
  return { branch: ref.slice('refs/heads/'.length), head, upstream, upstreamRef };
}

async function read(
  connection: RepositoryTransport,
  path: string,
  args: string[],
  allowMissing = false,
): Promise<string> {
  const result = await runGit(connection, path, args, undefined, {
    environment: { GIT_NO_LAZY_FETCH: '1' },
  });
  if (allowMissing && result.exitCode === 1) return '';
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '无法读取远程跟踪状态。');
  return result.stdout.trimEnd();
}

function refHead(connection: RepositoryTransport, path: string, ref: string) {
  return read(connection, path, ['rev-parse', '--verify', '--quiet', ref], true);
}

export async function backgroundFetch(connection: RepositoryTransport, path: string) {
  if (!(await read(connection, path, ['remote']))) return { fetched: false };
  const before = await readTrackingBranch(connection, path);
  const previous = before ? await refHead(connection, path, before.upstreamRef) : '';
  const result = await runGit(
    connection,
    path,
    ['fetch', '--no-recurse-submodules', '--no-auto-maintenance', '--no-write-fetch-head'],
    undefined,
    { nonInteractive: true },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || '获取远程更新失败。');

  const after = before && (await readTrackingBranch(connection, path));
  if (
    !before ||
    !after ||
    before.branch !== after.branch ||
    before.head !== after.head ||
    before.upstreamRef !== after.upstreamRef
  )
    return { fetched: true };
  const upstreamHead = await refHead(connection, path, after.upstreamRef);
  if (!upstreamHead || upstreamHead === previous) return { fetched: true };
  if (
    previous &&
    (await read(connection, path, ['rev-list', '--count', `${previous}..${upstreamHead}`])) === '0'
  )
    return { fetched: true };
  const behind = Number(
    await read(connection, path, ['rev-list', '--count', `${after.head}..${upstreamHead}`]),
  );
  return behind > 0
    ? {
        fetched: true,
        update: {
          branch: after.branch,
          head: after.head,
          upstream: after.upstream,
          upstreamHead,
          behind,
        },
      }
    : { fetched: true };
}
