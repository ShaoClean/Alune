import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CloudServerOutlined,
  LaptopOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@alune/ui/icons';
import {
  Button,
  CompactTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Tooltip,
} from '@alune/ui';
import type { CompactTableColumn } from '@alune/ui';
import type { Repository } from '@alune/domain';
import { RepositoryIdentity } from '../components/RepositoryIdentity';
import { RepositoryBranchCell } from '../components/RepositoryBranchCell';
import { RepositoryDetailStrip } from '../components/RepositoryDetailStrip';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { connectionStatus, connectionStatusLabel } from '../stores/connectionStatus';
import { repositoryAccessibleName, repositoryWorkspaceLabels } from '../stores/repositoryLabels';
import { LOCAL_GROUP_ID, repositoryGroupId } from '../stores/repositorySource';
import {
  groupBranchRepositories,
  repositoryBranchSummary,
} from '../stores/repositoryBranchOverview';
import type { RepositoryBranchSummary } from '../stores/repositoryBranchOverview';

type BranchRow = { repo: Repository; source: string; summary: RepositoryBranchSummary };

export function RepositoryBranchesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const source = searchParams.get('connectionId') || undefined;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const { connections, statuses: connectionStatuses, fetchConnections } = useConnectionStore();
  const {
    repositories,
    repositoryStatuses,
    listLoaded,
    listLoading,
    listError,
    fetchRepositories,
    refreshRepositoryStatuses,
    openRepository,
  } = useRepositoryStore();
  useEffect(() => {
    void fetchConnections();
    void fetchRepositories();
  }, [fetchConnections, fetchRepositories]);
  // Status age changes even when no network event arrives. The requests themselves
  // remain owned by the existing visibility observers and bounded status queue.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const labels = useMemo(() => repositoryWorkspaceLabels(repositories), [repositories]);
  const grouped = useMemo(
    () => groupBranchRepositories(repositories, connections, repositoryStatuses, query, source),
    [repositories, connections, repositoryStatuses, query, source],
  );
  const groups = grouped.map((group) => ({
    key: group.id,
    label: (
      <div className="branch-overview__source">
        <span>
          {group.local ? <LaptopOutlined /> : <CloudServerOutlined />}
          {group.name}
        </span>
        <span className="branch-overview__connection-state">
          {!group.local && (
            <i
              className={`connection-dot connection-dot--${connectionStatus(connectionStatuses[group.id])}`}
            />
          )}
          {group.local ? '本地' : connectionStatusLabel(connectionStatuses[group.id])}
        </span>
        <span>{group.repositories.length} 个仓库</span>
      </div>
    ),
    items: group.repositories.map((repo) => ({
      repo,
      source: group.name,
      summary: repositoryBranchSummary(
        repositoryStatuses[repo.id],
        group.local ? undefined : connectionStatuses[group.id],
        now,
      ),
    })),
  }));
  const rows = groups.flatMap((group) => group.items);
  const selected = rows.find((row) => row.repo.id === selectedId) || rows[0];
  const open = (repo: Repository) => {
    openRepository(repo);
    navigate(`/repositories/${encodeURIComponent(repo.id)}`);
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchRepositories(), fetchConnections()]);
      // Search may hide a repository whose branch has not been read yet. Refresh
      // the selected source, including hidden/new registrations, then re-filter.
      const targets = useRepositoryStore
        .getState()
        .repositories.filter((repo) => !source || repositoryGroupId(repo) === source);
      await refreshRepositoryStatuses(targets.map((repo) => repo.id));
    } finally {
      setRefreshing(false);
    }
  };
  const columns: CompactTableColumn<BranchRow>[] = [
    {
      key: 'repository',
      title: '仓库',
      width: 166,
      render: ({ repo, source: name }) => (
        <Tooltip title={repositoryAccessibleName(repo, name)}>
          <span className="branch-overview__identity">
            <RepositoryIdentity repo={repo} label={labels.get(repo.id)} />
          </span>
        </Tooltip>
      ),
    },
    {
      key: 'branch',
      title: '当前分支',
      render: ({ repo, summary }) => <RepositoryBranchCell id={repo.id} summary={summary} />,
    },
    {
      key: 'changes',
      title: '更改',
      width: 48,
      align: 'center',
      render: ({ summary }) => (
        <span
          className={summary.changedFiles ? 'branch-overview__dirty' : 'branch-overview__muted'}
          aria-label={
            summary.changedFiles === undefined
              ? '更改状态未知'
              : `${summary.changedFiles} 个文件有改动`
          }
        >
          {summary.changedFiles === undefined ? '?' : summary.changedFiles || '—'}
        </span>
      ),
    },
    {
      key: 'sync',
      title: '同步',
      width: 66,
      align: 'right',
      render: ({ summary }) => (
        <Tooltip title={summary.syncDescription}>
          <span className="branch-overview__sync" aria-label={summary.syncDescription}>
            {summary.sync}
          </span>
        </Tooltip>
      ),
    },
  ];
  const options = [
    { value: LOCAL_GROUP_ID, label: '本机' },
    ...connections.map((connection) => ({ value: connection.id, label: connection.name })),
  ];
  if (source && !options.some((option) => option.value === source))
    options.push({ value: source, label: '未知连接' });
  return (
    <section className="branch-overview" aria-label="仓库分支总览">
      <div className="branch-overview__toolbar">
        <Input
          aria-label="搜索仓库、分支或路径"
          placeholder="搜索仓库、分支或路径…"
          prefix={<SearchOutlined />}
          value={query}
          allowClear
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="筛选连接"
          placeholder="全部连接"
          allowClear
          value={source}
          options={options}
          onChange={(value) => setSearchParams(value ? { connectionId: value } : {})}
        />
        <Button
          icon={<ReloadOutlined />}
          loading={refreshing || listLoading}
          title="刷新所选连接下的所有仓库"
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      </div>
      {listError && (
        <ErrorState
          title={listLoaded ? '仓库列表刷新失败，已保留原有列表' : '仓库列表加载失败'}
          description={listError}
          onRetry={() => void refresh()}
        />
      )}
      {!listLoaded ? (
        !listError && <LoadingState label="正在加载已登记仓库…" />
      ) : (
        <CompactTable
          label="仓库分支总览"
          className="branch-overview__table"
          groupHeading="连接"
          groupWidth={100}
          groups={groups}
          columns={columns}
          rowKey={(row) => row.repo.id}
          rowLabel={(row) =>
            `${repositoryAccessibleName(row.repo, row.source)} · ${row.summary.branch}；回车打开工作区`
          }
          selectedKey={selected?.repo.id}
          onSelect={(row) => setSelectedId(row.repo.id)}
          onActivate={(row) => open(row.repo)}
          empty={
            <EmptyState
              compact
              title={repositories.length ? '没有匹配的仓库或分支' : '暂无已登记仓库'}
              description={
                repositories.length
                  ? '调整连接或搜索条件后重试。'
                  : '打开本机仓库，或添加远程仓库。'
              }
              action={
                <Button
                  size="small"
                  onClick={() => {
                    if (repositories.length) {
                      setQuery('');
                      setSearchParams({});
                    } else navigate('/repositories');
                  }}
                >
                  {repositories.length ? '清除筛选' : '管理仓库'}
                </Button>
              }
            />
          }
        />
      )}
      <RepositoryDetailStrip
        repo={selected?.repo}
        source={selected?.source}
        summary={selected?.summary}
        onOpen={open}
        onRefresh={(id) => void refreshRepositoryStatuses([id])}
      />
      <div className="branch-overview__summary">
        <span>
          {!listLoaded
            ? '仓库列表尚未加载'
            : rows.length === repositories.length
              ? `显示全部 ${rows.length} 个仓库`
              : `显示 ${rows.length} / ${repositories.length} 个仓库`}
        </span>
        <span>
          {rows.filter((row) => row.summary.busy).length > 0
            ? `${rows.filter((row) => row.summary.busy).length} 个读取中 · `
            : ''}
          {rows.filter((row) => row.summary.kind !== 'unknown' && !row.summary.stale).length}{' '}
          个状态有效
        </span>
      </div>
    </section>
  );
}
