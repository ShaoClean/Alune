import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Modal, Popconfirm, Select, Space, message } from 'antd';
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
import { EmptyState, formatBranchName, LoadingState, StatusBadge } from '../components/ui';

export function RepositoriesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionId = searchParams.get('connectionId') || undefined;
  const { connections, fetchConnections } = useConnectionStore();
  const { repositories, loading, fetchRepositories, scanRepositories, addRepository, deleteRepository, openRepository } = useRepositoryStore();
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
    if (!query) return repositories;
    return repositories.filter((repo: any) => `${repo.name} ${repo.path} ${repo.currentBranch || ''}`.toLowerCase().includes(query));
  }, [repositories, search]);

  const selectedConnection = connections.find((connection: any) => connection.id === connectionId);

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
          <p>{selectedConnection ? `${selectedConnection.name} 上可用的仓库。` : '浏览所有远程工作区中已登记的仓库。'}</p>
        </div>
        <div className="page-heading__actions">
          <Button icon={<ReloadOutlined />} aria-label="刷新仓库" onClick={() => void fetchRepositories(connectionId)}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!connectionId} onClick={() => setScanModalVisible(true)}>扫描并添加</Button>
        </div>
      </div>

      <div className="content-card">
        <div className="content-card__header">
          <Space wrap>
            <Select
              allowClear
              value={connectionId}
              onChange={chooseConnection}
              placeholder="全部连接"
              className="connection-filter"
              options={connections.map((connection: any) => ({ value: connection.id, label: connection.name }))}
            />
            <Input className="repo-search" allowClear prefix={<SearchOutlined />} placeholder="搜索仓库" value={search} onChange={(event) => setSearch(event.target.value)} />
          </Space>
          <span className="count-badge">{visibleRepositories.length} 个</span>
        </div>
        {loading && repositories.length === 0 ? <LoadingState label="正在加载仓库…" /> : visibleRepositories.length === 0 ? (
          <EmptyState title={search ? '没有匹配的仓库' : '暂无已登记的仓库'} description={search ? '请尝试其他名称、路径或分支。' : connectionId ? '扫描远程目录以发现 Git 仓库。' : '选择一个连接来扫描仓库，或前往“连接”页添加连接。'} action={!search && connectionId ? <Button type="primary" icon={<SearchOutlined />} onClick={() => setScanModalVisible(true)}>扫描远程路径</Button> : undefined} />
        ) : (
          <div className="repository-grid">
            {visibleRepositories.map((repo: any) => {
              const dirty = repo.isDirty === true;
              return (
                <article className="repository-card" key={repo.id}>
                  <div className="repository-card__top">
                    <div className="repository-card__title"><FolderOpenOutlined /><span>{repo.name}</span></div>
                    <StatusBadge status={dirty ? 'dirty' : repo.isDirty === false ? 'clean' : 'offline'} label={dirty ? '有改动' : repo.isDirty === false ? '干净' : '未知'} />
                  </div>
                  <div className="repository-card__path" title={repo.path}>{repo.path}</div>
                  <div className="repository-card__metrics">
                    <span className="repository-card__metric"><BranchesOutlined /> {repo.currentBranch ? formatBranchName(repo.currentBranch) : '无分支'}</span>
                    {(repo.ahead || 0) > 0 && <span className="repository-card__metric repository-card__metric--ahead">↑{repo.ahead}</span>}
                    {(repo.behind || 0) > 0 && <span className="repository-card__metric repository-card__metric--behind">↓{repo.behind}</span>}
                  </div>
                  <div className="repository-card__actions">
                    <Button size="small" type="primary" onClick={() => { openRepository(repo); navigate(`/repositories/${repo.id}`); }}>打开工作区</Button>
                    <Popconfirm title="移除此仓库？" onConfirm={() => void handleDelete(repo.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除 ${repo.name}`} />
                    </Popconfirm>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal title="扫描远程目录" open={scanModalVisible} onCancel={() => setScanModalVisible(false)} footer={null} width={650}>
        <p className="modal-description">在路径下最多向下搜索四层，查找包含 <code>.git</code> 目录的文件夹。</p>
        <Space.Compact block>
          <Input value={scanPath} onChange={(event) => setScanPath(event.target.value)} placeholder="/home/developer" />
          <Button type="primary" icon={<SearchOutlined />} loading={scanLoading} onClick={() => void handleScan()}>扫描</Button>
        </Space.Compact>
        {scanResults.length > 0 ? <div className="scan-results">{scanResults.map((path) => <div className="scan-result" key={path}><span>{path}</span><Button size="small" type="primary" icon={<PlusOutlined />} loading={addingPath === path} onClick={() => void handleAdd(path)}>添加</Button></div>)}</div> : <div className="modal-empty">执行扫描后将显示发现的仓库。</div>}
      </Modal>
    </div>
  );
}
