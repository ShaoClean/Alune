import type { ConnectionActivityStatus, RepositoryStatus } from '@alune/domain';
import type { RepositoryStatusEntry } from '../stores/repositoryStore';

export function repositorySyncStatus(
  entry?: RepositoryStatusEntry,
  connection?: ConnectionActivityStatus,
) {
  if (connection === 'disconnected' || connection === 'error' || connection === 'connecting')
    return undefined;
  // The status cache lifetime controls when to read Git again. Keep a known
  // comparison visible between fetch intervals until a read invalidates it.
  const status = entry?.data;
  if (
    entry?.stale ||
    entry?.phase === 'error' ||
    !status?.upstream ||
    status.upstreamComparisonUnavailable
  )
    return undefined;
  return status;
}

export function describeSyncCounts({ ahead, behind, upstream }: RepositoryStatus) {
  return `相对 ${upstream} 领先 ${ahead} 个提交，落后 ${behind} 个提交`;
}

export function RepositorySyncCounts({
  status,
  showZero = false,
}: {
  status: RepositoryStatus;
  showZero?: boolean;
}) {
  const { ahead, behind } = status;
  return (
    <span className="repository-sync-counts" aria-hidden="true">
      {(showZero || ahead > 0) && <span>↑{ahead}</span>}
      {(showZero || behind > 0) && (
        <span className={behind > 0 ? 'repository-sync-counts__behind' : undefined}>↓{behind}</span>
      )}
    </span>
  );
}
