import { OpenLocalRepository } from '../components/OpenLocalRepository';
import {
  LOCAL_GROUP_ID,
  repositoryGroupId,
  repositorySourceLabel,
} from '../stores/repositorySource';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Modal, Popconfirm, Select, Space, App } from 'antd';
import {
  BranchesOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { EmptyState, ErrorState, formatBranchName, LoadingState } from '../components/ui';

import { RepositoryStatusIndicator } from '../components/RepositoryStatusIndicator';

export function RepositoriesPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get('connectionId') || undefined;
  const connectionId = groupId === LOCAL_GROUP_ID ? undefined : groupId;
  const localOpen = searchParams.get('open') === 'local';
  const showLocal = () => setSearchParams({ open: 'local' });
  const [sort, setSort] = useState('name');
  const { connections, fetchConnections } = useConnectionStore();
  const {
    repositories,
    listLoading,
    listLoaded,
    listError,
    repositoryStatuses,
    refreshRepositoryStatuses,
    fetchRepositories,
    scanRepositories,
    addRepository,
    deleteRepository,
    openRepository,
  } = useRepositoryStore();
  const [search, setSearch] = useState('');
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [scanPath, setScanPath] = useState('/home');
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [addingPath, setAddingPath] = useState<string | null>(null);

  useEffect(() => {
    void fetchConnections();
    void fetchRepositories(connectionId);
  }, [connectionId, fetchConnections, fetchRepositories]);

  const visibleRepositories = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = (
      groupId
        ? repositories.filter((repo: any) => repositoryGroupId(repo) === groupId)
        : [...repositories]
    ).sort((a, b) =>
      sort === 'path' ? a.path.localeCompare(b.path) : a.name.localeCompare(b.name),
    );
    if (!query) return filtered;
    return filtered.filter((repo: any) =>
      `${repo.name} ${repo.path} ${repo.currentBranch || ''}`.toLowerCase().includes(query),
    );
  }, [repositories, search, groupId, sort]);

  const selectedConnection = connections.find((connection: any) => connection.id === connectionId);

  const refresh = () => {
    void fetchRepositories();
    void refreshRepositoryStatuses();
  };

  const chooseConnection = (value: string) => {
    if (value) setSearchParams({ connectionId: value });
    else setSearchParams({});
  };

  const handleScan = async () => {
    if (!connectionId) {
      message.warning('扫描前请选择连接');
      return;
    }
    setScanLoading(true);
    try {
      setScanResults(await scanRepositories(connectionId, scanPath));
    } catch (err: any) {
      message.error(err.message || '扫描路径失败');
    } finally {
      setScanLoading(false);
    }
  };

  const handleAdd = async (path: string) => {
    if (!connectionId) return;
    setAddingPath(path);
    try {
      await addRepository(connectionId, path);
      message.success('仓库已添加');
      void fetchRepositories(connectionId);
    } catch (err: any) {
      message.error(err.message || '添加仓库失败');
    } finally {
      setAddingPath(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRepository(id);
      message.success('仓库已移除');
    } catch (err: any) {
      message.error(err.message || '移除仓库失败');
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div>
          <h2>仓库</h2>
          <p>
            {selectedConnection
              ? `${selectedConnection.name} 上可用的仓库。`
              : '打开本机仓库，或连接 SSH 远程工作区。'}
          </p>
        </div>
        <div className="page-heading__actions">
          <Button
            icon={<ReloadOutlined />}
            loading={listLoading}
            aria-label="刷新仓库"
            onClick={refresh}
          >
            刷新
          </Button>
          <Button type="primary" icon={<FolderOpenOutlined />} onClick={showLocal}>
            打开本地仓库
          </Button>
          <Button
            icon={<PlusOutlined />}
            disabled={!connectionId}
            onClick={() => setScanModalVisible(true)}
          >
            扫描并添加
          </Button>
        </div>
      </div>

      <div className="content-card">
        <div className="content-card__header">
          <Space wrap>
            <Select
              allowClear
              value={groupId}
              onChange={chooseConnection}
              placeholder="全部来源"
              className="connection-filter"
              options={[
                { value: LOCAL_GROUP_ID, label: '本机' },
                ...connections.map((connection: any) => ({
                  value: connection.id,
                  label: `SSH · ${connection.name}`,
                })),
              ]}
            />
            <Select
              aria-label="仓库排序"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name', label: '按名称' },
                { value: 'path', label: '按路径' },
              ]}
            />
            <Input
              className="repo-search"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索仓库"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Space>
          <span className="count-badge">
            {listLoaded ? `${visibleRepositories.length} 个` : '—'}
          </span>
        </div>
        {listError && (
          <ErrorState
            title={listLoaded ? '仓库列表刷新失败，已保留原有列表' : '已登记仓库加载失败'}
            description={listError}
            onRetry={refresh}
          />
        )}
        {!listLoaded && repositories.length === 0 ? (
          !listError && <LoadingState label="正在加载已登记仓库…" />
        ) : visibleRepositories.length === 0 ? (
          listLoaded &&
          !listError && (
            <EmptyState
              title={search || connectionId ? '没有匹配的仓库' : '暂无已登记的仓库'}
              description={
                search
                  ? '请尝试其他名称、路径或分支。'
                  : connectionId
                    ? '此连接下没有已登记仓库，可扫描远程目录添加。'
                    : '从本机打开已有 Git 仓库；也可以在“连接”页配置 SSH。'
              }
              action={
                !search && connectionId ? (
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={() => setScanModalVisible(true)}
                  >
                    扫描远程路径
                  </Button>
                ) : (
                  <Button type="primary" icon={<FolderOpenOutlined />} onClick={showLocal}>
                    打开本地仓库
                  </Button>
                )
              }
            />
          )
        ) : (
          <div className="repository-grid">
            {visibleRepositories.map((repo: any) => {
              const entry = repositoryStatuses[repo.id];
              return (
                <article className="repository-card" key={repo.id}>
                  <div className="repository-card__top">
                    <div className="repository-card__title">
                      <FolderOpenOutlined />
                      <span>{repo.name}</span>
                      <span className="source-badge">{repositorySourceLabel(repo)}</span>
                    </div>
                    <RepositoryStatusIndicator id={repo.id} />
                  </div>
                  <div className="repository-card__path" title={repo.path}>
                    {repo.path}
                  </div>
                  <div className="repository-card__metrics">
                    <span className="repository-card__metric">
                      <BranchesOutlined />{' '}
                      {entry?.data
                        ? formatBranchName(entry.data.branch) === '—'
                          ? '游离 HEAD'
                          : formatBranchName(entry.data.branch)
                        : '分支未知'}
                    </span>
                    {(repo.ahead || 0) > 0 && (
                      <span className="repository-card__metric repository-card__metric--ahead">
                        ↑{repo.ahead}
                      </span>
                    )}
                    {(repo.behind || 0) > 0 && (
                      <span className="repository-card__metric repository-card__metric--behind">
                        ↓{repo.behind}
                      </span>
                    )}
                  </div>
                  <div className="repository-card__actions">
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        openRepository(repo);
                        navigate(`/repositories/${repo.id}`);
                      }}
                    >
                      打开工作区
                    </Button>
                    <Button
                      size="small"
                      aria-label={`刷新 ${repo.name} 状态`}
                      loading={entry?.phase === 'loading' || entry?.phase === 'queued'}
                      onClick={() => void refreshRepositoryStatuses([repo.id])}
                    >
                      {entry?.phase === 'error' ? '重试状态' : '刷新状态'}
                    </Button>
                    <Popconfirm
                      title="移除此仓库？"
                      description="仅移除应用内登记，保留仓库目录与文件。"
                      onConfirm={() => void handleDelete(repo.id)}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`删除 ${repo.name}`}
                      />
                    </Popconfirm>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <OpenLocalRepository
        open={localOpen}
        onClose={() => setSearchParams(groupId ? { connectionId: groupId } : {})}
      />
      <Modal
        title="扫描远程目录"
        open={scanModalVisible}
        onCancel={() => setScanModalVisible(false)}
        footer={null}
        width={650}
      >
        <p className="modal-description">
          在路径下最多向下搜索四层，查找包含 <code>.git</code> 目录的文件夹。
        </p>
        <Space.Compact block>
          <Input
            value={scanPath}
            onChange={(event) => setScanPath(event.target.value)}
            placeholder="/home/developer"
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={scanLoading}
            onClick={() => void handleScan()}
          >
            扫描
          </Button>
        </Space.Compact>
        {scanResults.length > 0 ? (
          <div className="scan-results">
            {scanResults.map((path) => (
              <div className="scan-result" key={path}>
                <span>{path}</span>
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  loading={addingPath === path}
                  onClick={() => void handleAdd(path)}
                >
                  添加
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="modal-empty">执行扫描后将显示发现的仓库。</div>
        )}
      </Modal>
    </div>
  );
}
