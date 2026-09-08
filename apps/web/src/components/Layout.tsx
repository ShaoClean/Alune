import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  BranchesOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  DownOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { RepositoryTabs } from './RepositoryTabs';

const navItems = [
  { key: '/', label: '连接', icon: <ApartmentOutlined /> },
  { key: '/repositories', label: '仓库', icon: <FolderOpenOutlined /> },
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
      <aside className="app-sidebar" aria-label="主导航">
        <div className="app-sidebar__header">
          <button className="app-brand" type="button" aria-label="RemoteGit 首页" onClick={() => navigate('/')}>
            <span className="app-brand__mark"><CodeOutlined /></span>
            <span className="app-brand__text">RemoteGit</span>
          </button>
          <Button type="text" className="sidebar-toggle" aria-label={collapsed ? '展开导航' : '收起导航'} icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} />
        </div>

        <div className="app-sidebar__content">
          <nav className="sidebar-primary-nav" aria-label="主菜单">
            {navItems.map((item) => (
              <Tooltip key={item.key} title={collapsed ? item.label : undefined} placement="right">
                <button
                  type="button"
                  className={`sidebar-nav-item${selectedKey === item.key ? ' sidebar-nav-item--active' : ''}`}
                  aria-label={item.label}
                  aria-current={selectedKey === item.key ? 'page' : undefined}
                  onClick={() => navigate(item.key)}
                >
                  <span className="sidebar-nav-item__icon">{item.icon}</span>
                  <span className="sidebar-nav-item__label">{item.label}</span>
                </button>
              </Tooltip>
            ))}
          </nav>

          <div className="sidebar-divider" />

          <section className="sidebar-workspace" aria-label="工作区资源">
            <div className="sidebar-section__heading">
              <span>工作区</span>
              <span className="sidebar-section__count">{connections.length + repositories.length}</span>
            </div>
            <button type="button" className="sidebar-workspace__toggle" onClick={() => setTreeOpen(!treeOpen)}>
              <FolderOpenOutlined className="sidebar-workspace__icon" />
              <span>远程工作区</span>
              <span className="sidebar-workspace__chevron">{treeOpen ? <DownOutlined /> : <RightOutlined />}</span>
            </button>
            {treeOpen && (
              <div className="resource-tree">
                {connectionGroups.length === 0 && <div className="tree-empty">暂无连接</div>}
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
              <FolderOpenOutlined /> <span>浏览全部仓库</span>
            </button>
          </section>
        </div>

        <div className="app-sidebar__footer">
          <div className="sidebar-footer__actions">
            <Tooltip title={collapsed ? '设置' : undefined} placement="right">
              <button type="button" className="sidebar-footer__item" aria-label="设置"><SettingOutlined /><span>设置</span></button>
            </Tooltip>
            <Tooltip title={collapsed ? '帮助' : undefined} placement="right">
              <button type="button" className="sidebar-footer__item" aria-label="帮助"><QuestionCircleOutlined /><span>帮助</span></button>
            </Tooltip>
          </div>
          <div className="sidebar-footer__account">
            <span className="sidebar-footer__avatar"><CodeOutlined /></span>
            <div className="sidebar-footer__account-copy">
              <strong>RemoteGit</strong>
              <span>工作区就绪</span>
            </div>
            <span className="sidebar-footer__version">v0.1</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button type="button" className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}

      <main className="app-main">
        {selectedKey === '/repositories' && <RepositoryTabs repositories={openRepositories} activeId={activeRepository?.id} onSelect={(id) => navigate(`/repositories/${id}`)} onClose={handleCloseRepository} onOpenRepository={() => navigate('/repositories')} />}
        <div className="app-content"><Outlet /></div>
        <footer className="status-bar">
          <div className="status-bar__left"><Button type="text" className="mobile-nav-trigger" icon={<MenuUnfoldOutlined />} aria-label="打开导航" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(!mobileNavOpen)} /><CloudSyncOutlined /> <span>RemoteGit 已连接</span>{activeRepository && <><span className="status-bar__separator">•</span><span className="status-bar__path">{activeRepository.path || '仓库工作区'}</span></>}</div>
          <div className="status-bar__right"><span>上次刷新 {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
        </footer>
      </main>
    </div>
  );
}
