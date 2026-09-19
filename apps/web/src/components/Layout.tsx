import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useOutlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, message, notification } from 'antd';
import {
  ApartmentOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { RepositoryTabs } from './RepositoryTabs';
import { useDesktopUpdates } from '../hooks/useDesktopUpdates';
import { WorkspaceTree } from './WorkspaceTree';
import { useWorkspaceStorageStatus } from '../stores/workspaceStorage';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { PanelResizeHandle } from './PanelResizeHandle';
import { SettingsCenter } from './settings/SettingsCenter';
import { PanelToggle } from './PanelToggle';
import { WorkspaceMenu } from './WorkspaceMenu';
import { SIDEBAR_MIN } from '../stores/workspaceLayout';
import { WorkspaceStatusBar } from './WorkspaceStatusBar';

const navItems = [
  { key: '/', label: '连接', icon: <ApartmentOutlined /> },
  { key: '/repositories', label: '仓库', icon: <FolderOpenOutlined /> },
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettings = location.pathname.startsWith('/settings');
  const [rightPanelAvailable, setRightPanelAvailable] = useState(true);
  const [repositoryToolbarSlot, setRepositoryToolbarSlot] = useState<HTMLDivElement | null>(null);
  const outlet = useOutlet({ setRightPanelAvailable, repositoryToolbarSlot });
  const workspaceOutlet = useRef(outlet);
  const workspaceFocus = useRef<HTMLElement | null>(null);
  const lastWorkspacePath = useRef('/repositories');
  if (!isSettings) {
    workspaceOutlet.current = outlet;
    lastWorkspacePath.current = `${location.pathname}${location.search}${location.hash}`;
  }
  const returnTo = location.state?.returnTo;
  const workspacePath =
    typeof returnTo === 'string' &&
    returnTo.startsWith('/') &&
    !returnTo.startsWith('//') &&
    !returnTo.startsWith('/settings')
      ? returnTo
      : lastWorkspacePath.current;
  const openSettings = useCallback(
    (category = 'providers') => {
      navigate(`/settings/${category}`, { state: { returnTo: lastWorkspacePath.current } });
    },
    [navigate],
  );
  useEffect(() => {
    if (
      !isSettings &&
      workspaceFocus.current?.isConnected &&
      workspaceFocus.current.getClientRects().length
    ) {
      workspaceFocus.current.focus();
    }
  }, [isSettings]);
  const { layout, updateLayout, compact, sidebarWidth, sidebarMax } = useWorkspaceLayout();
  const collapsed = !compact && layout.sidebarCollapsed;
  const sidebarRef = useRef<HTMLElement>(null);
  const storageError = useWorkspaceStorageStatus((state) => state.error);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarVisible = compact ? mobileNavOpen : !collapsed;
  const [repositoryQuery, setRepositoryQuery] = useState('');
  const updates = useDesktopUpdates();
  const { state: updateState, isDesktop } = updates;
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
          <Button type="primary" size="small" onClick={() => openSettings('updates')}>
            查看更新
          </Button>
        ),
        duration: 8,
      });
    }
  }, [updateState, notifications, openSettings]);
  const { connections, testResults, fetchConnections } = useConnectionStore();
  const {
    repositories,
    openRepositories,
    currentRepo,
    fetchRepositories,
    openRepository,
    closeRepository,
    deleteRepository,
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
  }, [location.pathname]);

  useEffect(() => {
    if (!compact) setMobileNavOpen(false);
  }, [compact]);

  useEffect(() => {
    // Expanding moves the toggle from the tab bar into the sidebar header.
    if (
      sidebarVisible &&
      !compact &&
      workspaceFocus.current?.matches('.panel-toggle[aria-controls="workspace-sidebar"]') &&
      !workspaceFocus.current.isConnected
    )
      sidebarRef.current
        ?.querySelector<HTMLButtonElement>('[aria-controls="workspace-sidebar"]')
        ?.focus();
    if (!sidebarVisible && sidebarRef.current?.contains(document.activeElement))
      document
        .querySelector<HTMLButtonElement>('.app-tabbar [aria-controls="workspace-sidebar"]')
        ?.focus();
    if (
      layout.changesCollapsed &&
      document.querySelector('#workspace-list')?.contains(document.activeElement)
    )
      document
        .querySelector<HTMLButtonElement>('.app-tabbar [aria-controls="workspace-list"]')
        ?.focus();
  }, [sidebarVisible, compact, layout.changesCollapsed]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === ',') {
        event.preventDefault();
        openSettings();
        return;
      }
      if (isSettings) return;
      if (event.key.toLowerCase() === 'b' || event.key === '\\') {
        event.preventDefault();
        if (event.shiftKey) {
          if (rightPanelAvailable) updateLayout({ changesCollapsed: !layout.changesCollapsed });
        } else if (compact) setMobileNavOpen((open) => !open);
        else updateLayout({ sidebarCollapsed: !layout.sidebarCollapsed });
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [
    compact,
    layout.sidebarCollapsed,
    layout.changesCollapsed,
    updateLayout,
    openSettings,
    isSettings,
    rightPanelAvailable,
  ]);

  useEffect(() => {
    if (!compact || !mobileNavOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sidebar = sidebarRef.current;
    const focusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ||
          [],
      ).filter((element) => element.getClientRects().length > 0);
    sidebar?.querySelector<HTMLButtonElement>('button')?.focus();
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

  const handleDeleteRepository = async (repo: any) => {
    const isActive = activeRepositoryId === repo.id;
    const closedIndex = openRepositories.findIndex((item: any) => item.id === repo.id);
    const nextRepository =
      closedIndex >= 0
        ? openRepositories[closedIndex + 1] || openRepositories[closedIndex - 1]
        : undefined;

    try {
      await deleteRepository(repo.id);
      message.success(`已移除仓库“${repo.name}”`);
      if (isActive) navigate(nextRepository ? `/repositories/${nextRepository.id}` : '/repositories');
    } catch (err: any) {
      message.error(err.message || `移除仓库“${repo.name}”失败`);
    }
  };

  return (
    <>
      {notificationContext}
      {isSettings && <SettingsCenter returnTo={workspacePath} updates={updates} />}
      <div
        className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}${mobileNavOpen ? ' app-shell--mobile-open' : ''}`}
        style={
          {
            '--sidebar-width': `${sidebarWidth}px`,
            display: isSettings ? 'none' : undefined,
          } as CSSProperties
        }
        inert={isSettings}
        onFocusCapture={(event) => {
          if (!isSettings && event.target instanceof HTMLElement)
            workspaceFocus.current = event.target;
        }}
      >
        <div className="app-tabbar" inert={compact && mobileNavOpen}>
          {(!sidebarVisible || compact) && (
            <div className="app-tabbar__leading">
              <WorkspaceMenu
                compact
                version={'v' + __APP_VERSION__}
                onSettings={() => openSettings()}
              />
              <PanelToggle
                side="left"
                expanded={sidebarVisible}
                controls="workspace-sidebar"
                onClick={() =>
                  compact
                    ? setMobileNavOpen(!mobileNavOpen)
                    : updateLayout({ sidebarCollapsed: !collapsed })
                }
              />
            </div>
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
          {activeRepositoryId && (
            <PanelToggle
              side="right"
              expanded={rightPanelAvailable && !layout.changesCollapsed}
              disabled={!rightPanelAvailable}
              controls="workspace-list"
              onClick={() => updateLayout({ changesCollapsed: !layout.changesCollapsed })}
            />
          )}
        </div>
        <aside
          ref={sidebarRef}
          id="workspace-sidebar"
          className="app-sidebar"
          aria-label="主导航"
          role={compact && mobileNavOpen ? 'dialog' : undefined}
          aria-modal={compact && mobileNavOpen ? true : undefined}
          inert={!sidebarVisible}
        >
          <div className="app-sidebar__header">
            <strong>工作区</strong>
            <div className="app-sidebar__header-actions">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                aria-label="管理连接"
                title="管理连接"
                onClick={() => navigate('/')}
              />
              <PanelToggle
                side="left"
                expanded
                controls="workspace-sidebar"
                onClick={() =>
                  compact ? setMobileNavOpen(false) : updateLayout({ sidebarCollapsed: true })
                }
              />
            </div>
          </div>
          <div className="app-sidebar__content">
            <Input
              className="sidebar-search"
              aria-label="查找仓库"
              placeholder="查找仓库…"
              prefix={<SearchOutlined />}
              allowClear
              value={repositoryQuery}
              onChange={(event) => setRepositoryQuery(event.target.value)}
            />
            <nav className="sidebar-primary-nav" aria-label="主菜单">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`sidebar-nav-item${selectedKey === item.key ? ' sidebar-nav-item--active' : ''}`}
                  aria-label={item.label}
                  aria-current={selectedKey === item.key ? 'page' : undefined}
                  onClick={() => navigate(item.key)}
                >
                  <span className="sidebar-nav-item__icon">{item.icon}</span>
                  <span className="sidebar-nav-item__label">{item.label}</span>
                  <span className="sidebar-section__count">
                    {item.key === '/' ? connections.length : repositories.length}
                  </span>
                </button>
              ))}
            </nav>

            <div className="sidebar-divider" />

            <section className="sidebar-workspace" aria-label="工作区资源">
              <WorkspaceTree
                query={repositoryQuery}
                connections={connections}
                repositories={repositories}
                testResults={testResults}
                activeId={activeRepository?.id}
                onOpenRepository={handleOpenRepository}
                onDeleteRepository={handleDeleteRepository}
              />
            </section>
          </div>

          <div className="app-sidebar__footer">
            {sidebarVisible && (
              <WorkspaceMenu
                version={
                  isDesktop
                    ? updateState
                      ? 'v' + updateState.currentVersion
                      : '…'
                    : 'v' + __APP_VERSION__
                }
                onSettings={() => {
                  setMobileNavOpen(false);
                  openSettings();
                }}
              />
            )}
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

        {activeRepositoryId && (
          <div
            ref={setRepositoryToolbarSlot}
            className="repository-toolbar-row"
            inert={compact && mobileNavOpen}
          />
        )}

        <main className="app-main" inert={compact && mobileNavOpen}>
          <div className={`app-content${activeRepositoryId ? ' app-content--workspace' : ''}`}>
            {workspaceOutlet.current}
          </div>
        </main>
        <WorkspaceStatusBar
          repository={activeRepository}
          repositories={openRepositories}
          inert={compact && mobileNavOpen}
          notices={[
            ...(storageError ? [storageError] : []),
            ...(updateState?.status === 'available'
              ? [`RemoteGit v${updateState.latestVersion} 可用`]
              : []),
          ]}
          onUpdates={isDesktop ? () => openSettings('updates') : undefined}
        />
      </div>
    </>
  );
}
