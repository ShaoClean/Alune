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
  const { log, logLoading: loading, fetchLog } = useRepositoryStore();

  useEffect(() => {
    void fetchLog(repoId);
  }, [repoId, fetchLog]);

  return (
    <section className="workspace-panel">
      <PanelHeader title="提交历史" count={log.length} description="当前仓库的最近提交记录" icon={<HistoryOutlined />} extra={<Button type="text" icon={<ReloadOutlined />} aria-label="刷新提交历史" onClick={() => void fetchLog(repoId)} loading={loading}>刷新</Button>} />
      {log.length === 0 && !loading ? <EmptyState title="暂无提交" description="此仓库没有可显示的历史记录。" /> : <div className="commit-list">
        {log.map((commit: any) => (
          <button type="button" className={`commit-row${selectedHash === commit.hash ? ' commit-row--selected' : ''}`} key={commit.hash} onClick={() => onSelectCommit?.(commit)}>
            <span className="commit-row__graph"><span className="commit-row__dot" /><span className="commit-row__line" /></span>
            <span className="commit-row__avatar">{initials(commit.author)}</span>
            <span className="commit-row__body">
              <span className="commit-row__message">{commit.message || '无提交信息'}</span>
              <span className="commit-row__meta"><span>{commit.author}</span><span className="commit-row__separator">•</span><ClockCircleOutlined /> <span title={commit.date ? new Date(commit.date).toLocaleString('zh-CN') : undefined}>{formatRelativeDate(commit.date)}</span></span>
            </span>
            <span className="commit-row__refs">{(commit.refs || []).map((ref: string) => <RefBadge key={ref} value={ref} />)}</span>
            <code className="commit-row__hash">{commit.shortHash}</code>
          </button>
        ))}
        {log.length >= 50 && <Button className="load-more-button" icon={<BranchesOutlined />} onClick={() => void fetchLog(repoId, { count: 50, skip: log.length })}>加载更多提交</Button>}
      </div>}
    </section>
  );
}
