import { FolderOpenOutlined, ReloadOutlined } from '@alune/ui/icons';
import { Button, Tooltip } from '@alune/ui';
import type { Repository } from '@alune/domain';
import type { RepositoryBranchSummary } from '../stores/repositoryBranchOverview';

export function RepositoryDetailStrip({
  repo,
  source,
  summary,
  onOpen,
  onRefresh,
}: {
  repo?: Repository;
  source?: string;
  summary?: RepositoryBranchSummary;
  onOpen: (repo: Repository) => void;
  onRefresh: (id: string) => void;
}) {
  if (!repo || !summary)
    return <div className="repository-detail-strip">选择仓库查看路径与读取状态</div>;
  const timestamp =
    summary.updatedAt === undefined
      ? '尚未成功读取'
      : `${summary.stale ? '缓存' : '读取于'} ${new Date(summary.updatedAt).toLocaleString()}`;
  return (
    <div className="repository-detail-strip">
      <div className="repository-detail-strip__identity" aria-live="polite">
        <Tooltip title={`${source} · ${repo.path}`}>
          <span className="repository-detail-strip__path">
            <FolderOpenOutlined />
            {source} · {repo.path}
          </span>
        </Tooltip>
        <span className="repository-detail-strip__state">
          {timestamp}
          {summary.error ? ` · ${summary.error}` : ''}
        </span>
      </div>
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={summary.busy}
        aria-label={`刷新 ${repo.name} 状态`}
        onClick={() => onRefresh(repo.id)}
      />
      <Button size="small" onClick={() => onOpen(repo)}>
        打开工作区
      </Button>
    </div>
  );
}
