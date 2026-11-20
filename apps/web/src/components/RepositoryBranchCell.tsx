import { BranchesOutlined, DisconnectOutlined } from '@alune/ui/icons';
import { MoonLoader, Tooltip } from '@alune/ui';
import { useRepositoryVisibility } from '../hooks/useRepositoryStatus';
import type { RepositoryBranchSummary } from '../stores/repositoryBranchOverview';

export function RepositoryBranchCell({
  id,
  summary,
}: {
  id: string;
  summary: RepositoryBranchSummary;
}) {
  const observe = useRepositoryVisibility(id);
  const title = [
    summary.branch,
    summary.note,
    summary.error,
    summary.updatedAt !== undefined
      ? `读取于 ${new Date(summary.updatedAt).toLocaleString()}`
      : '尚未成功读取',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Tooltip title={title} trigger={['hover', 'focus']}>
      <span
        ref={observe}
        className={`repository-branch-cell${summary.stale ? ' repository-branch-cell--stale' : ''}`}
        aria-label={title}
      >
        {summary.busy ? (
          <MoonLoader size="small" />
        ) : summary.kind === 'detached' ? (
          <DisconnectOutlined />
        ) : (
          <BranchesOutlined />
        )}
        <span className="repository-branch-cell__name">{summary.branch}</span>
        {summary.note && <span className="repository-branch-cell__note">{summary.note}</span>}
      </span>
    </Tooltip>
  );
}
