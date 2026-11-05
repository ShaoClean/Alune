import { REPOSITORY_STATUS_CACHE_MS } from '@alune/domain';
import type { ConnectionStatusInfo, Repository } from '@alune/domain';
import type { RepositoryStatusEntry } from './repositoryStore';
import { LOCAL_GROUP_ID, repositoryGroupId } from './repositorySource';

export interface RepositoryBranchSummary {
  branch: string;
  kind: 'branch' | 'detached' | 'unborn' | 'unknown';
  note: string;
  stale: boolean;
  busy: boolean;
  error?: string;
  updatedAt?: number;
  changedFiles?: number;
  sync: string;
  syncDescription: string;
}

export function repositoryBranchSummary(
  entry: RepositoryStatusEntry | undefined,
  connection: ConnectionStatusInfo | undefined,
  now: number,
): RepositoryBranchSummary {
  const data = entry?.data;
  const busy = entry?.phase === 'queued' || entry?.phase === 'loading';
  const offline = connection?.status === 'disconnected' || connection?.status === 'error';
  const stale = Boolean(
    data &&
    (offline ||
      entry?.stale ||
      entry?.phase === 'error' ||
      entry?.updatedAt === undefined ||
      now - entry.updatedAt >= REPOSITORY_STATUS_CACHE_MS),
  );
  const kind = !data
    ? 'unknown'
    : data.unborn
      ? 'unborn'
      : !data.branch || data.branch === 'HEAD'
        ? 'detached'
        : 'branch';
  const branch = !data
    ? busy
      ? '正在读取…'
      : entry?.phase === 'error'
        ? '读取失败'
        : '分支未知'
    : kind === 'detached'
      ? '游离 HEAD'
      : data.branch;
  const note = busy
    ? data
      ? stale
        ? '更新中 · 缓存'
        : '更新中'
      : ''
    : entry?.phase === 'error'
      ? data
        ? '失败 · 缓存'
        : ''
      : offline
        ? data
          ? '离线 · 缓存'
          : '离线'
        : stale
          ? '缓存已过期'
          : kind === 'unborn'
            ? '未首次提交'
            : '';
  let sync = '未知';
  let syncDescription = data ? '状态已过期，请刷新后确认同步状态' : '尚未读取同步状态';
  if (data && !stale) {
    sync =
      kind === 'detached' || kind === 'unborn'
        ? '—'
        : data.ahead || data.behind
          ? [data.ahead ? `↑${data.ahead}` : '', data.behind ? `↓${data.behind}` : '']
              .filter(Boolean)
              .join(' ')
          : data.upstream
            ? '已同步'
            : '未跟踪';
    syncDescription =
      kind === 'detached'
        ? '游离 HEAD，无跟踪分支'
        : kind === 'unborn'
          ? '尚未创建首次提交'
          : data.ahead || data.behind
            ? `${data.ahead} 个提交待推送，${data.behind} 个提交待拉取`
            : data.upstream
              ? `与 ${data.upstream} 已同步`
              : '没有跟踪分支';
  }
  return {
    branch,
    kind,
    note,
    stale,
    busy,
    error: entry?.error,
    updatedAt: entry?.updatedAt,
    changedFiles: data && !stale ? new Set(data.files.map((file) => file.path)).size : undefined,
    sync,
    syncDescription,
  };
}

export interface RepositoryBranchGroup {
  id: string;
  name: string;
  local: boolean;
  repositories: Repository[];
}

export function groupBranchRepositories(
  repositories: readonly Repository[],
  connections: readonly { id: string; name: string }[],
  statuses: Record<string, RepositoryStatusEntry>,
  query: string,
  source?: string,
): RepositoryBranchGroup[] {
  const search = query.trim().toLocaleLowerCase();
  const names = new Map([
    [LOCAL_GROUP_ID, '本机'],
    ...connections.map((connection) => [connection.id, connection.name] as const),
  ]);
  const bySource = new Map<string, Repository[]>();
  for (const repo of repositories) {
    const id = repositoryGroupId(repo);
    if (source && source !== id) continue;
    if (
      search &&
      !`${repo.name} ${repo.path} ${statuses[repo.id]?.data?.branch ?? repo.currentBranch ?? ''} ${names.get(id) || ''}`
        .toLocaleLowerCase()
        .includes(search)
    )
      continue;
    const rows = bySource.get(id) || [];
    rows.push(repo);
    bySource.set(id, rows);
  }
  const order = [...names.keys(), ...bySource.keys()].filter(
    (id, index, ids) => ids.indexOf(id) === index,
  );
  return order
    .filter((id) => bySource.has(id))
    .map((id) => ({
      id,
      name: names.get(id) || '未知连接',
      local: id === LOCAL_GROUP_ID,
      repositories: bySource.get(id)!,
    }));
}
