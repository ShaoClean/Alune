import { useEffect } from 'react';
import { Button } from 'antd';
import { BranchesOutlined, ClockCircleOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { EmptyState, formatRelativeDate, PanelHeader, RefBadge } from './ui';

interface Props {
  repoId: string;
  onSelectCommit?: (commit: any) => void;
  selectedHash?: string | null;
}

const initials = (author: string) => author.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

export function HistoryView({ repoId, onSelectCommit, selectedHash }: Props) {
  const { log, loading, fetchLog } = useRepositoryStore();

  useEffect(() => {
    void fetchLog(repoId);
  }, [repoId, fetchLog]);

  return (
    <section className="workspace-panel">
      <PanelHeader title="Commits" count={log.length} description="Recent history for the current repository" icon={<HistoryOutlined />} extra={<Button type="text" icon={<ReloadOutlined />} aria-label="Refresh history" onClick={() => void fetchLog(repoId)} loading={loading}>Refresh</Button>} />
      {log.length === 0 && !loading ? <EmptyState title="No commits yet" description="This repository does not have any visible history." /> : <div className="commit-list">
        {log.map((commit: any) => (
          <button type="button" className={`commit-row${selectedHash === commit.hash ? ' commit-row--selected' : ''}`} key={commit.hash} onClick={() => onSelectCommit?.(commit)}>
            <span className="commit-row__graph"><span className="commit-row__dot" /><span className="commit-row__line" /></span>
            <span className="commit-row__avatar">{initials(commit.author)}</span>
            <span className="commit-row__body">
              <span className="commit-row__message">{commit.message || 'No commit message'}</span>
              <span className="commit-row__meta"><span>{commit.author}</span><span className="commit-row__separator">•</span><ClockCircleOutlined /> <span title={commit.date ? new Date(commit.date).toLocaleString() : undefined}>{formatRelativeDate(commit.date)}</span></span>
            </span>
            <span className="commit-row__refs">{(commit.refs || []).map((ref: string) => <RefBadge key={ref} value={ref} />)}</span>
            <code className="commit-row__hash">{commit.shortHash}</code>
          </button>
        ))}
        {log.length >= 50 && <Button className="load-more-button" icon={<BranchesOutlined />} onClick={() => void fetchLog(repoId, { count: 50, skip: log.length })}>Load more commits</Button>}
      </div>}
    </section>
  );
}
