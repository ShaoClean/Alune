import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Dropdown, Tooltip, message, notification } from 'antd';
import {
  ApartmentOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { RepositoryTabs } from './RepositoryTabs';
import { UpdatePanel } from './UpdatePanel';
import { useDesktopUpdates } from '../hooks/useDesktopUpdates';
import { WorkspaceTree } from './WorkspaceTree';
import { useWorkspaceStorageStatus } from '../stores/workspaceStorage';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { PanelResizeHandle } from './PanelResizeHandle';
import { LayoutSettings } from './LayoutSettings';
import { SIDEBAR_MIN } from '../stores/workspaceLayout';

const navItems = [
  { key: '/', label: '连接', icon: <ApartmentOutlined /> },
  { key: '/repositories', label: '仓库', icon: <FolderOpenOutlined /> },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { layout, updateLayout, compact, sidebarWidth, sidebarMax } = useWorkspaceLayout();
  const collapsed = !compact && layout.sidebarCollapsed;
  const [layoutSettingsOpen, setLayoutSettingsOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const storageError = useWorkspaceStorageStatus((state) => state.error);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const { state: updateState, bridgeError, invoke, isDesktop } = useDesktopUpdates();
  const [notifications, notificationContext] = notification.useNotification();
  const notifiedVersion = useRef<string | null>(null);
  useEffect(() => {
    if (
      updateState?.status === 'available' &&
      updateState.background &&
      updateState.latestVersion !== notifiedVersion.current
    ) {
      notifiedVersion.current = updateState.latestVersion;
      notifications.info({
        title: `RemoteGit v${updateState.latestVersion} 可用`,
        description: '新版本已发布，可查看更新说明并下载安装。',
        actions: (
          <Button type="primary" size="small" onClick={() => setUpdatesOpen(true)}>
            查看更新
          </Button>
        ),
        duration: 8,
      });
    }
  }, [updateState, notifications]);
  const [repositoryMenuOpen, setRepositoryMenuOpen] = useState(false);
  const repositoryMenuTrigger = useRef<HTMLButtonElement>(null);
  const { connections, testResults, fetchConnections } = useConnectionStore();
  const {
    repositories,
    openRepositories,
    currentRepo,
    fetchRepositories,
    openRepository,
    closeRepository,
  } = useRepositoryStore();

  useEffect(() => {
    void fetchConnections();
    void fetchRepositories();
  }, [fetchConnections, fetchRepositories]);

  useEffect(() => {
    if (storageError) void message.error({ key: 'workspace-storage', content: storageError });
  }, [storageError]);

  useEffect(() => {
    setMobileNavOpen(false);
    setRepositoryMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!compact) setMobileNavOpen(false);
  }, [compact]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        if (compact) setMobileNavOpen((open) => !open);
        else updateLayout({ sidebarCollapsed: !layout.sidebarCollapsed });
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [compact, layout.sidebarCollapsed, updateLayout]);

  useEffect(() => {
    if (!compact || !mobileNavOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sidebar = sidebarRef.current;
    const focusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ||
          [],
      ).filter((element) => element.getClientRects().length > 0);
    sidebar?.querySelector<HTMLButtonElement>('.sidebar-toggle')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const target = event.shiftKey ? elements.at(-1) : elements[0];
      if (document.activeElement === (event.shiftKey ? elements[0] : elements.at(-1))) {
        event.preventDefault();
        target?.focus();
      }
    };
    sidebar?.addEventListener('keydown', onKeyDown);
    return () => {
      sidebar?.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [compact, mobileNavOpen]);

  const openLayoutSettings = () => {
    setMobileNavOpen(false);
    setLayoutSettingsOpen(true);
  };

  const selectedKey = useMemo(() => {
    if (location.pathname.startsWith('/repositories')) return '/repositories';
    return '/';
  }, [location.pathname]);

  const activeRepositoryId = location.pathname.match(/^\/repositories\/([^/]+)/)?.[1];
  const activeRepository =
    openRepositories.find((repo: any) => repo.id === activeRepositoryId) ||
    (currentRepo?.id === activeRepositoryId ? currentRepo : null);

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
    <div
      className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}${mobileNavOpen ? ' app-shell--mobile-open' : ''}`}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      {notificationContext}
      <LayoutSettings open={layoutSettingsOpen} onClose={() => setLayoutSettingsOpen(false)} />
      {isDesktop && (
        <UpdatePanel
          open={updatesOpen}
          onClose={() => setUpdatesOpen(false)}
          state={updateState}
          error={bridgeError}
          invoke={invoke}
        />
      )}
      <aside
        ref={sidebarRef}
        id="workspace-sidebar"
        className="app-sidebar"
        aria-label="主导航"
        role={compact && mobileNavOpen ? 'dialog' : undefined}
        aria-modal={compact && mobileNavOpen ? true : undefined}
        inert={compact && !mobileNavOpen}
      >
        <div className="app-sidebar__header">
          <button
            className="app-brand"
            type="button"
            aria-label="RemoteGit 首页"
            onClick={() => navigate('/')}
          >
            <span className="app-brand__mark">
              <CodeOutlined />
            </span>
            <span className="app-brand__text">RemoteGit</span>
          </button>
          <Button
            type="text"
            className="sidebar-toggle"
            aria-label={compact ? '关闭导航' : collapsed ? '展开导航' : '收起导航'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() =>
              compact ? setMobileNavOpen(false) : updateLayout({ sidebarCollapsed: !collapsed })
            }
          />
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
              <span className="sidebar-section__count">
                {connections.length + repositories.length}
              </span>
            </div>
            <WorkspaceTree
              connections={connections}
              repositories={repositories}
              testResults={testResults}
              activeId={activeRepository?.id}
              onOpenRepository={handleOpenRepository}
            />
            <button
              type="button"
              className="sidebar-link"
              onClick={() => navigate('/repositories')}
            >
              <FolderOpenOutlined /> <span>浏览全部仓库</span>
            </button>
          </section>
        </div>

        <div className="app-sidebar__footer">
          <div className="sidebar-footer__actions">
            <Tooltip title="布局设置" placement="right">
              <button
                type="button"
                className="sidebar-footer__item"
                aria-label="布局设置"
                onClick={openLayoutSettings}
              >
                <MenuUnfoldOutlined />
                <span>布局设置</span>
              </button>
            </Tooltip>
            <Tooltip title={collapsed ? '设置' : undefined} placement="right">
              <button
                type="button"
                className="sidebar-footer__item"
                aria-label="设置"
                onClick={() => setUpdatesOpen(true)}
                disabled={!isDesktop}
              >
                <SettingOutlined />
                <span>设置</span>
              </button>
            </Tooltip>
            <Tooltip title={collapsed ? '帮助' : undefined} placement="right">
              <button type="button" className="sidebar-footer__item" aria-label="帮助">
                <QuestionCircleOutlined />
                <span>帮助</span>
              </button>
            </Tooltip>
          </div>
          <div className="sidebar-footer__account">
            <span className="sidebar-footer__avatar">
              <CodeOutlined />
            </span>
            <div className="sidebar-footer__account-copy">
              <strong>RemoteGit</strong>
              <span>工作区就绪</span>
            </div>
            <span className="sidebar-footer__version">
              {isDesktop
                ? updateState
                  ? `v${updateState.currentVersion}`
                  : '…'
                : `v${__APP_VERSION__}`}
            </span>
          </div>
        </div>
      </aside>

      {!compact && !collapsed && (
        <PanelResizeHandle
          className="sidebar-resize-handle"
          label="调整工作区宽度"
          controls="workspace-sidebar"
          value={sidebarWidth}
          min={SIDEBAR_MIN}
          max={sidebarMax}
          onChange={(width) => updateLayout({ sidebarWidth: width })}
        />
      )}

      {mobileNavOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main className="app-main" inert={compact && mobileNavOpen}>
        <div className="app-tabbar">
          {compact && (
            <Button
              type="text"
              icon={<MenuUnfoldOutlined />}
              aria-label="打开工作区"
              aria-expanded={mobileNavOpen}
              aria-controls="workspace-sidebar"
              onClick={() => setMobileNavOpen(true)}
            />
          )}
          {selectedKey === '/repositories' && openRepositories.length > 0 ? (
            <RepositoryTabs
              repositories={openRepositories}
              activeId={activeRepository?.id}
              onSelect={(id) => navigate(`/repositories/${id}`)}
              onClose={handleCloseRepository}
              onOpenRepository={() => navigate('/repositories')}
            />
          ) : (
            <span className="app-tabbar__title">{selectedKey === '/' ? '连接' : '仓库'}</span>
          )}
          <Button
            type="text"
            className="app-tabbar__settings"
            icon={<SettingOutlined />}
            aria-label="调整工作区布局"
            title="布局设置"
            onClick={openLayoutSettings}
          />
        </div>
        <div className={`app-content${activeRepositoryId ? ' app-content--workspace' : ''}`}>
          <Outlet />
        </div>
        <footer className="status-bar">
          <div className="status-bar__left">
            <Button
              type="text"
              className="mobile-nav-trigger"
              icon={<MenuUnfoldOutlined />}
              aria-label="打开导航"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
            />
            <span className="status-bar__connection">
              <CloudSyncOutlined /> <span>RemoteGit 已连接</span>
            </span>
            <Dropdown
              trigger={['click']}
              placement="topLeft"
              align={{ overflow: { adjustX: true, adjustY: true, shiftX: true } }}
              autoFocus
              open={repositoryMenuOpen}
              onOpenChange={setRepositoryMenuOpen}
              classNames={{ root: 'status-bar-repositories' }}
              menu={{
                id: 'status-bar-repository-menu',
                'aria-label': '已打开的仓库',
                selectable: true,
                selectedKeys: activeRepositoryId ? [activeRepositoryId] : [],
                items: openRepositories.length
                  ? openRepositories.map((repo) => {
                      const connection = connections.find((item) => item.id === repo.connectionId);
                      const details = `${connection?.name || repo.connectionId} · ${repo.path || '仓库工作区'}`;
                      return {
                        key: repo.id,
                        icon: <FolderOpenOutlined />,
                        label: (
                          <span
                            className="status-bar-repository"
                            title={`${repo.name} · ${details}`}
                          >
                            <span className="status-bar-repository__name">{repo.name}</span>
                            <span className="status-bar-repository__details">{details}</span>
                          </span>
                        ),
                        onClick: () => navigate(`/repositories/${repo.id}`),
                      };
                    })
                  : [
                      { key: 'empty', label: '暂无已打开的仓库', disabled: true },
                      {
                        key: 'browse',
                        label: '浏览仓库',
                        icon: <FolderOpenOutlined />,
                        onClick: () => navigate('/repositories'),
                      },
                    ],
                onClick: () => {
                  setRepositoryMenuOpen(false);
                  repositoryMenuTrigger.current?.focus();
                },
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    setRepositoryMenuOpen(false);
                    repositoryMenuTrigger.current?.focus();
                  }
                },
              }}
            >
              <button
                ref={repositoryMenuTrigger}
                type="button"
                className="status-bar__repositories-trigger"
                aria-haspopup="menu"
                aria-expanded={repositoryMenuOpen}
                aria-controls={repositoryMenuOpen ? 'status-bar-repository-menu' : undefined}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setRepositoryMenuOpen(true);
                  }
                }}
              >
                <FolderOpenOutlined />
                <span>已打开仓库 · {openRepositories.length}</span>
                <UpOutlined />
              </button>
            </Dropdown>
            {activeRepository && (
              <>
                <span className="status-bar__separator">•</span>
                <span className="status-bar__path" title={activeRepository.path}>
                  {activeRepository.path || '仓库工作区'}
                </span>
              </>
            )}
          </div>
          <div className="status-bar__right">
            <span>
              上次刷新{' '}
              {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
