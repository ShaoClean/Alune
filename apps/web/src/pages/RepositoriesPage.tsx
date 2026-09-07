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
      message.warning('Select a connection before scanning');
      return;
    }
    setScanLoading(true);
    try {
      setScanResults(await scanRepositories(connectionId, scanPath));
    } catch (err: any) {
      message.error(err.message || 'Failed to scan path');
    } finally {
      setScanLoading(false);
    }
  };

  const handleAdd = async (path: string) => {
    if (!connectionId) return;
    setAddingPath(path);
    try {
      await addRepository(connectionId, path);
      message.success('Repository added');
      void fetchRepositories(connectionId);
    } catch (err: any) {
      message.error(err.message || 'Failed to add repository');
    } finally {
      setAddingPath(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRepository(id);
      message.success('Repository removed');
    } catch (err: any) {
      message.error(err.message || 'Failed to remove repository');
    }
  };

  return (
    <div>
      <div className="page-heading">
        <div>
          <h2>Repositories</h2>
          <p>{selectedConnection ? `Repositories available on ${selectedConnection.name}.` : 'Browse every registered repository across your remote workspaces.'}</p>
        </div>
        <div className="page-heading__actions">
          <Button icon={<ReloadOutlined />} aria-label="Refresh repositories" onClick={() => void fetchRepositories(connectionId)}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled={!connectionId} onClick={() => setScanModalVisible(true)}>Scan &amp; add</Button>
        </div>
      </div>

      <div className="content-card">
        <div className="content-card__header">
          <Space wrap>
            <Select
              allowClear
              value={connectionId}
              onChange={chooseConnection}
              placeholder="All connections"
              className="connection-filter"
              options={connections.map((connection: any) => ({ value: connection.id, label: connection.name }))}
            />
            <Input className="repo-search" allowClear prefix={<SearchOutlined />} placeholder="Search repositories" value={search} onChange={(event) => setSearch(event.target.value)} />
          </Space>
          <span className="count-badge">{visibleRepositories.length} shown</span>
        </div>
        {loading && repositories.length === 0 ? <LoadingState label="Loading repositories…" /> : visibleRepositories.length === 0 ? (
          <EmptyState title={search ? 'No matching repositories' : 'No repositories registered'} description={search ? 'Try a different name, path, or branch.' : connectionId ? 'Scan a remote directory to discover Git repositories.' : 'Choose a connection to scan for repositories, or add one from Connections.'} action={!search && connectionId ? <Button type="primary" icon={<SearchOutlined />} onClick={() => setScanModalVisible(true)}>Scan remote path</Button> : undefined} />
        ) : (
          <div className="repository-grid">
            {visibleRepositories.map((repo: any) => {
              const dirty = repo.isDirty === true;
              return (
                <article className="repository-card" key={repo.id}>
                  <div className="repository-card__top">
                    <div className="repository-card__title"><FolderOpenOutlined /><span>{repo.name}</span></div>
                    <StatusBadge status={dirty ? 'dirty' : repo.isDirty === false ? 'clean' : 'offline'} label={dirty ? 'Changes' : repo.isDirty === false ? 'Clean' : 'Unknown'} />
                  </div>
                  <div className="repository-card__path" title={repo.path}>{repo.path}</div>
                  <div className="repository-card__metrics">
                    <span className="repository-card__metric"><BranchesOutlined /> {repo.currentBranch ? formatBranchName(repo.currentBranch) : 'No branch'}</span>
                    {(repo.ahead || 0) > 0 && <span className="repository-card__metric repository-card__metric--ahead">↑{repo.ahead}</span>}
                    {(repo.behind || 0) > 0 && <span className="repository-card__metric repository-card__metric--behind">↓{repo.behind}</span>}
                  </div>
                  <div className="repository-card__actions">
                    <Button size="small" type="primary" onClick={() => { openRepository(repo); navigate(`/repositories/${repo.id}`); }}>Open workspace</Button>
                    <Popconfirm title="Remove this repository?" onConfirm={() => void handleDelete(repo.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${repo.name}`} />
                    </Popconfirm>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Modal title="Scan remote directories" open={scanModalVisible} onCancel={() => setScanModalVisible(false)} footer={null} width={650}>
        <p className="modal-description">Search up to four levels below a path for folders containing a <code>.git</code> directory.</p>
        <Space.Compact block>
          <Input value={scanPath} onChange={(event) => setScanPath(event.target.value)} placeholder="/home/developer" />
          <Button type="primary" icon={<SearchOutlined />} loading={scanLoading} onClick={() => void handleScan()}>Scan</Button>
        </Space.Compact>
        {scanResults.length > 0 ? <div className="scan-results">{scanResults.map((path) => <div className="scan-result" key={path}><span>{path}</span><Button size="small" type="primary" icon={<PlusOutlined />} loading={addingPath === path} onClick={() => void handleAdd(path)}>Add</Button></div>)}</div> : <div className="modal-empty">Run a scan to see discovered repositories.</div>}
      </Modal>
    </div>
  );
}
