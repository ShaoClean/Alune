import { useFeedbackMessage } from '@alune/ui';
import { OpenLocalRepository } from '../components/OpenLocalRepository';
import { RemoveRepositoryConfirm } from '../components/AlunePopconfirm';
import {
  LOCAL_GROUP_ID,
  repositoryGroupId,
  repositorySourceLabel,
} from '../stores/repositorySource';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Select, Space } from '@alune/ui';
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
import { EmptyState, ErrorState, LoadingState } from '@alune/ui';
import { formatBranchName } from '../components/ui';

import { RepositoryStatusIndicator } from '../components/RepositoryStatusIndicator';
import { CollectionViewSwitch } from '../components/CollectionViewSwitch';
import { RepositoryOverview } from '../components/RepositoryOverview';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { AluneModal, DialogHints, Kbd } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogEmpty, DialogPath, DialogProgress } from '@alune/ui';

const pathName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

export function RepositoriesPage() {
  const message = useFeedbackMessage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get('connectionId') || undefined;
  const connectionId = groupId === LOCAL_GROUP_ID ? undefined : groupId;
  const localOpen = searchParams.get('open') === 'local';
  const showLocal = () => setSearchParams({ open: 'local' });
  const [sort, setSort] = useState('name');
  const [overviewRevision, setOverviewRevision] = useState(0);
  const { connections, fetchConnections } = useConnectionStore();
  const view = useWorkspaceStore((state) => state.collectionViews.repositories);
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
  // Path of the last successful scan, so the result header and empty state name what was searched.
  const [scannedPath, setScannedPath] = useState<string | null>(null);
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
    setOverviewRevision((value) => value + 1);
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
      const found = await scanRepositories(connectionId, scanPath);
      setScanResults(found);
      setScannedPath(scanPath);
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

  const renderBranch = (repo: any) => {
    const entry = repositoryStatuses[repo.id];
    const branch = entry?.data
      ? formatBranchName(entry.data.branch) === '—'
        ? '游离 HEAD'
        : formatBranchName(entry.data.branch)
      : '分支未知';
    return (
      <div className="repository-card__metrics">
        <span className="repository-card__metric" title={branch}>
          <BranchesOutlined />
          <span className="collection-text">{branch}</span>
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
    );
  };

  const renderActions = (repo: any) => {
    const entry = repositoryStatuses[repo.id];
    return (
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
        <RemoveRepositoryConfirm repository={repo} onConfirm={() => handleDelete(repo.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除 ${repo.name}`} />
        </RemoveRepositoryConfirm>
      </div>
    );
  };

  return (
    <div className="repositories-page">
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
          <CollectionViewSwitch page="repositories" />
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
        <div className="content-card__header collection-filter-bar">
          <Space wrap>
            <Select
              aria-label="仓库来源"
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
        ) : view === 'overview' ? (
          <>
            {visibleRepositories.length === 0 && (
              <EmptyState
                title={repositories.length ? '没有匹配的仓库' : '暂无已登记的仓库'}
                description={
                  repositories.length
                    ? '请调整来源或搜索条件。'
                    : '打开本地仓库，或配置 SSH 后开始统计。'
                }
                action={
                  repositories.length ? (
                    <Button
                      onClick={() => {
                        setSearch('');
                        chooseConnection('');
                      }}
                    >
                      清除筛选
                    </Button>
                  ) : (
                    <Button onClick={showLocal}>打开本地仓库</Button>
                  )
                }
              />
            )}
            <RepositoryOverview
              repositories={visibleRepositories}
              connections={connections}
              revision={overviewRevision}
            />
          </>
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
        ) : view === 'list' ? (
          <div
            className="collection-table-scroll"
            role="region"
            aria-label="仓库列表，可横向滚动"
            tabIndex={0}
          >
            <table className="collection-table repository-table" aria-label="仓库列表">
              <colgroup>
                <col />
                <col className="collection-table__connection-column" />
                <col className="collection-table__branch-column" />
                <col className="collection-table__status-column" />
                <col className="collection-table__actions-column" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">仓库 / 路径</th>
                  <th scope="col">来源 / 连接</th>
                  <th scope="col">分支</th>
                  <th scope="col">状态</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRepositories.map((repo: any) => {
                  const connectionName =
                    repo.source === 'local'
                      ? '本机'
                      : `SSH · ${connections.find((connection: any) => connection.id === repo.connectionId)?.name || '未知连接'}`;
                  return (
                    <tr key={repo.id}>
                      <th scope="row">
                        <div className="repository-card__title">
                          <FolderOpenOutlined />
                          <span className="collection-text" title={repo.name}>
                            {repo.name}
                          </span>
                        </div>
                        <div
                          className="collection-table__secondary collection-table__mono"
                          title={repo.path}
                        >
                          {repo.path}
                        </div>
                      </th>
                      <td>
                        <span className="collection-text" title={connectionName}>
                          {connectionName}
                        </span>
                      </td>
                      <td>{renderBranch(repo)}</td>
                      <td>
                        <RepositoryStatusIndicator id={repo.id} />
                      </td>
                      <td>{renderActions(repo)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="repository-grid">
            {visibleRepositories.map((repo: any) => (
              <article className="repository-card" key={repo.id}>
                <div className="repository-card__top">
                  <div className="repository-card__title">
                    <FolderOpenOutlined />
                    <span className="collection-text" title={repo.name}>
                      {repo.name}
                    </span>
                    <span className="source-badge">{repositorySourceLabel(repo)}</span>
                  </div>
                  <RepositoryStatusIndicator id={repo.id} />
                </div>
                <div className="repository-card__path" title={repo.path}>
                  {repo.path}
                </div>
                {renderBranch(repo)}
                {renderActions(repo)}
              </article>
            ))}
          </div>
        )}
      </div>

      <OpenLocalRepository
        open={localOpen}
        onClose={() => setSearchParams(groupId ? { connectionId: groupId } : {})}
      />
      <AluneModal
        open={scanModalVisible}
        size="lg"
        glyph="search"
        eyebrow={{
          label: '仓库',
          detail: selectedConnection ? `SSH · ${selectedConnection.name}` : 'SSH',
        }}
        title="扫描远程目录"
        description={
          <>
            从指定路径向下搜索最多四层，查找包含 <code>.git</code> 目录的文件夹。
          </>
        }
        okDisabled={scanLoading}
        // The scan is not awaited, so the dialog never locks and can be closed mid-scan as before.
        onOk={() => {
          void handleScan();
        }}
        onCancel={() => setScanModalVisible(false)}
        hints={
          <DialogHints>
            <span>
              <Kbd>↵</Kbd> 扫描
            </span>
            <i />
            <span>逐个添加，无需关闭弹窗</span>
            <i />
            <span>
              <Kbd>Esc</Kbd> 关闭
            </span>
          </DialogHints>
        }
        footer={<Button onClick={() => setScanModalVisible(false)}>完成</Button>}
      >
        <div className="dlg-inp-group">
          <Input
            aria-label="扫描路径"
            className="dlg-mono-input"
            prefix={<DialogIcon name="server" />}
            value={scanPath}
            onChange={(event) => setScanPath(event.target.value)}
            placeholder="/home/developer"
            autoComplete="off"
            spellCheck={false}
            data-autofocus
          />
          <Button
            className={scanLoading ? 'is-busy' : undefined}
            aria-busy={scanLoading || undefined}
            onClick={() => {
              if (!scanLoading) void handleScan();
            }}
          >
            {scanLoading ? <span className="dlg-moonload" aria-hidden="true" /> : null}
            <span>{scanLoading ? '扫描中' : '开始扫描'}</span>
          </Button>
        </div>
        {scanLoading ? (
          <DialogProgress label="正在搜索远程目录…" />
        ) : scanResults.length > 0 ? (
          <>
            <p className="dlg-sub">
              <span>发现 {scanResults.length} 个仓库</span>
              {scannedPath ? <small>{scannedPath}</small> : null}
            </p>
            <DialogCard>
              <div className={scanResults.length > 4 ? 'dlg-list is-scroll' : 'dlg-list'}>
                {scanResults.map((path) => {
                  const added = repositories.some(
                    (repo: any) => repo.connectionId === connectionId && repo.path === path,
                  );
                  return (
                    <div className="dlg-list-item" key={path}>
                      <DialogIcon name="folder" />
                      <div className="dlg-list-main">
                        <strong>{pathName(path)}</strong>
                        <DialogPath path={path} />
                      </div>
                      {added ? (
                        <span className="dlg-badge" data-tone="success">
                          <DialogIcon name="check" />
                          已添加
                        </span>
                      ) : (
                        <Button
                          className="dlg-btn-xs"
                          aria-label={`添加 ${path}`}
                          loading={addingPath === path}
                          onClick={() => void handleAdd(path)}
                        >
                          添加
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </DialogCard>
          </>
        ) : (
          <DialogCard>
            <DialogEmpty>
              {scannedPath !== null ? (
                <>
                  在 <code>{scannedPath}</code> 下没有找到 Git
                  仓库。可以换一个上级目录，或检查此用户的读取权限。
                </>
              ) : (
                '执行扫描后，将在这里列出发现的仓库。'
              )}
            </DialogEmpty>
          </DialogCard>
        )}
      </AluneModal>
    </div>
  );
}
