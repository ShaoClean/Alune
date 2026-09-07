import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Tooltip } from 'antd';
import {
  ApiOutlined,
  ApartmentOutlined,
  BranchesOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  DownOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  TeamOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { StatusBadge } from './ui';
import { RepositoryTabs } from './RepositoryTabs';

const navItems = [
  { key: '/', label: 'Connections', icon: <ApartmentOutlined /> },
  { key: '/repositories', label: 'Repositories', icon: <FolderOpenOutlined /> },
  { key: '/ai', label: 'AI Gateway', icon: <ApiOutlined /> },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { connections, testResults, fetchConnections } = useConnectionStore();
  const { repositories, openRepositories, currentRepo, fetchRepositories, openRepository, closeRepository } = useRepositoryStore();

  useEffect(() => {
    void fetchConnections();
    void fetchRepositories();
  }, [fetchConnections, fetchRepositories]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const selectedKey = useMemo(() => {
    if (location.pathname.startsWith('/repositories')) return '/repositories';
    if (location.pathname.startsWith('/ai')) return '/ai';
    return '/';
  }, [location.pathname]);

  const connectionGroups = connections.map((connection: any) => ({
    ...connection,
    repositories: repositories.filter((repo: any) => repo.connectionId === connection.id),
  }));

  const activeRepositoryId = location.pathname.match(/^\/repositories\/([^/]+)/)?.[1];
  const activeRepository = openRepositories.find((repo: any) => repo.id === activeRepositoryId)
    || (currentRepo?.id === activeRepositoryId ? currentRepo : null);

  const handleOpenRepository = (repo: any) => {
    openRepository(repo);
    navigate(`/repositories/${repo.id}`);
  };

  const handleCloseRepository = (id: string) => {
    const closedIndex = openRepositories.findIndex((repo: any) => repo.id === id);
    const isActive = activeRepositoryId === id;
    const nextRepository = openRepositories[closedIndex + 1] || openRepositories[closedIndex - 1];

    closeRepository(id);
    if (isActive) navigate(nextRepository ? `/repositories/${nextRepository.id}` : '/repositories');
  };

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}${mobileNavOpen ? ' app-shell--mobile-open' : ''}`}>
      <aside className="activity-bar" aria-label="Primary navigation">
        <button className="brand-mark" type="button" aria-label="RemoteGit home" onClick={() => navigate('/')}>
          <CodeOutlined />
        </button>
        <nav className="activity-bar__nav">
          {navItems.map((item) => (
            <Tooltip key={item.key} title={collapsed ? item.label : undefined} placement="right">
              <button
                type="button"
                className={`activity-button${selectedKey === item.key ? ' activity-button--active' : ''}`}
                aria-label={item.label}
                onClick={() => navigate(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
        <div className="activity-bar__bottom">
          <Tooltip title={collapsed ? 'Settings' : undefined} placement="right">
            <button type="button" className="activity-button" aria-label="Settings"><SettingOutlined /><span>Settings</span></button>
          </Tooltip>
          <Tooltip title={collapsed ? 'Help' : undefined} placement="right">
            <button type="button" className="activity-button" aria-label="Help"><QuestionCircleOutlined /><span>Help</span></button>
          </Tooltip>
        </div>
      </aside>

      <aside className="resource-sidebar" aria-label="Workspace resources">
        <div className="resource-sidebar__header">
          <div>
            <div className="eyebrow">REMOTE GIT</div>
            <h1>Workspace</h1>
          </div>
          <Button type="text" className="sidebar-toggle" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
        </div>
        <div className="resource-sidebar__content">
          <div className="sidebar-section__heading">
            <span>Resources</span>
            <span className="sidebar-section__count">{connections.length + repositories.length}</span>
          </div>
          <button type="button" className="tree-section-toggle" onClick={() => setTreeOpen(!treeOpen)}>
            {treeOpen ? <DownOutlined /> : <UpOutlined />} <span>Remote workspaces</span>
          </button>
          {treeOpen && (
            <div className="resource-tree">
              {connectionGroups.length === 0 && <div className="tree-empty">No connections yet</div>}
              {connectionGroups.map((connection: any) => (
                <div className="tree-group" key={connection.id}>
                  <div className="tree-node tree-node--connection">
                    <span className={`connection-dot connection-dot--${connection.status || (testResults[connection.id]?.success ? 'connected' : testResults[connection.id] ? 'error' : 'disconnected')}`} />
                    <span className="tree-node__label">{connection.name}</span>
                    <span className="tree-node__meta">{connection.repositories.length}</span>
                  </div>
                  {connection.repositories.map((repo: any) => (
                    <button
                      type="button"
                      className={`tree-node tree-node--repo${activeRepository?.id === repo.id ? ' tree-node--selected' : ''}`}
                      key={repo.id}
                      onClick={() => handleOpenRepository(repo)}
                    >
                      <BranchesOutlined className="tree-node__icon" />
                      <span className="tree-node__label">{repo.name}</span>
                      {repo.isDirty && <span className="tree-node__dirty" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          <button type="button" className="sidebar-link" onClick={() => navigate('/repositories')}>
            <FolderOpenOutlined /> Browse all repositories
          </button>
        </div>
        <div className="resource-sidebar__footer">
          <StatusBadge status="ready" label="Workspace ready" />
          <span className="sidebar-footer__version">v0.1</span>
        </div>
      </aside>

      <div className="mobile-nav-trigger">
        <Button type="text" icon={<MenuUnfoldOutlined />} aria-label="Open navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)} />
      </div>

      <main className="app-main">
        <header className="app-topbar">
          <div className="breadcrumb-wrap">
            <span className="breadcrumb-root">RemoteGit</span>
            <span className="breadcrumb-divider">/</span>
            <span>{navItems.find((item) => item.key === selectedKey)?.label}</span>
            {activeRepository && <><span className="breadcrumb-divider">/</span><strong>{activeRepository.name}</strong></>}
          </div>
          <div className="topbar-actions">
            <StatusBadge status="connected" label="API online" subtle />
            <button type="button" className="topbar-icon" aria-label="Team"><TeamOutlined /></button>
          </div>
        </header>
        {selectedKey === '/repositories' && <RepositoryTabs repositories={openRepositories} activeId={activeRepository?.id} onSelect={(id) => navigate(`/repositories/${id}`)} onClose={handleCloseRepository} onOpenRepository={() => navigate('/repositories')} />}
        <div className="app-content"><Outlet /></div>
        <footer className="status-bar">
          <div className="status-bar__left"><CloudSyncOutlined /> <span>RemoteGit connected</span>{activeRepository && <><span className="status-bar__separator">•</span><span className="status-bar__path">{activeRepository.path || 'Repository workspace'}</span></>}</div>
          <div className="status-bar__right"><span>Last refresh {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
        </footer>
      </main>
    </div>
  );
}
