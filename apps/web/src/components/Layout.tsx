import { useFeedbackMessage } from './useFeedbackMessage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useOutlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useConnectionStore } from '../stores/connectionStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { RepositoryTabs } from './RepositoryTabs';
import { useDesktopUpdates } from '../hooks/useDesktopUpdates';
import { useConnectionStatusSync } from '../hooks/useConnectionStatusSync';
import { WorkspaceTree } from './WorkspaceTree';
import { useWorkspaceStorageStatus } from '../stores/workspaceStorage';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { PanelResizeHandle } from './PanelResizeHandle';
import { SettingsCenter, SettingsNavigation, getSettingsCategory } from './settings/SettingsCenter';
import { PanelToggle } from './PanelToggle';
import { SIDEBAR_MIN } from '../stores/workspaceLayout';
import { WorkspaceStatusBar } from './WorkspaceStatusBar';
import { FeedbackNotice, FeedbackScope } from './Feedback';
import { useWorkspaceStore } from '../stores/workspaceStore';

const navItems = [
  { key: '/connections', label: '连接', icon: <ApartmentOutlined /> },
  { key: '/repositories', label: '仓库', icon: <FolderOpenOutlined /> },
];

export function Layout() {
  const message = useFeedbackMessage();
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
  const settingsCategory = getSettingsCategory(location.pathname);
  const focusSettingsBack = useCallback(() => {
    Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-back'))
      .find((button) => button.getClientRects().length && !button.closest('[inert]'))
      ?.focus();
  }, []);
  const openSettings = useCallback(
    (category?: string) => {
      if (isSettings && (!category || category === settingsCategory.id)) {
        focusSettingsBack();
        return;
      }
      navigate(`/settings/${category || 'providers'}`, { state: { returnTo: workspacePath } });
    },
    [navigate, isSettings, settingsCategory.id, workspacePath, focusSettingsBack],
  );
  const selectSettings = (id: string) => {
    if (id === settingsCategory.id) setMobileNavOpen(false);
    else
      navigate(`/settings/${id}`, {
        replace: true,
        state: { ...location.state, returnTo: workspacePath },
      });
  };
  useEffect(() => {
    if (isSettings) {
      focusSettingsBack();
      return;
    }
    if (
      !isSettings &&
      workspaceFocus.current?.isConnected &&
      workspaceFocus.current.getClientRects().length
    ) {
      workspaceFocus.current.focus({ preventScroll: true });
    } else if (!isSettings)
      document
        .querySelector<HTMLElement>('.repository-tab--active button, .sidebar-nav-item--active')
        ?.focus({ preventScroll: true });
  }, [isSettings, focusSettingsBack]);
  const { layout, updateLayout, compact, sidebarWidth, sidebarMax } = useWorkspaceLayout();
  const collapsed = !compact && layout.sidebarCollapsed;
  const sidebarRef = useRef<HTMLElement>(null);
  const shellFocus = useRef<HTMLElement | null>(null);
  const workspaceSidebar = useRef<HTMLDivElement>(null);
  const sidebarScroll = useRef(0);
  useLayoutEffect(() => {
    if (!isSettings && workspaceSidebar.current)
      workspaceSidebar.current.scrollTop = sidebarScroll.current;
  }, [isSettings]);
  const storageError = useWorkspaceStorageStatus((state) => state.error);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarVisible = compact ? mobileNavOpen : !collapsed;
  const [repositoryQuery, setRepositoryQuery] = useState('');
  const updates = useDesktopUpdates();
  const { state: updateState, isDesktop } = updates;
  const { connections, statuses, fetchConnections } = useConnectionStore();
  useConnectionStatusSync();
  const {
    repositories,
    openRepositories,
    currentRepo,
    fetchRepositories,
    openRepository,
    moveOpenRepository,
    closeRepository,
    closeRepositories,
    deleteRepository,
    activateRepositoryTab,
    listLoaded,
  } = useRepositoryStore();

  useEffect(() => {
    void fetchConnections();
    void fetchRepositories();
  }, [fetchConnections, fetchRepositories]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!compact) setMobileNavOpen(false);
  }, [compact]);

  useLayoutEffect(() => {
    // Focus follows controls when their visible copy moves between the sidebar and tab bar.
    const previous = shellFocus.current;
    if (
      isSettings &&
      previous?.matches('.settings-back') &&
      (!previous.isConnected || !previous.getClientRects().length)
    ) {
      focusSettingsBack();
    } else if (
      sidebarVisible &&
      !compact &&
      previous?.matches('.panel-toggle[aria-controls="workspace-sidebar"]') &&
      !previous.isConnected
    ) {
      sidebarRef.current
        ?.querySelector<HTMLButtonElement>('[aria-controls="workspace-sidebar"]')
        ?.focus();
    } else if (!sidebarVisible && sidebarRef.current?.contains(previous)) {
      document
        .querySelector<HTMLButtonElement>('.app-tabbar [aria-controls="workspace-sidebar"]')
        ?.focus();
    }
    if (
      !isSettings &&
      layout.changesCollapsed &&
      document.querySelector('#workspace-list')?.contains(document.activeElement)
    )
      document
        .querySelector<HTMLButtonElement>('.app-tabbar [aria-controls="workspace-list"]')
        ?.focus();
  }, [sidebarVisible, compact, layout.changesCollapsed, isSettings, focusSettingsBack]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === ',') {
        event.preventDefault();
        openSettings();
        return;
      }
      if (event.key.toLowerCase() === 'b' || event.key === '\\') {
        event.preventDefault();
        if (event.shiftKey) {
          if (!isSettings && rightPanelAvailable)
            updateLayout({ changesCollapsed: !layout.changesCollapsed });
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
    const previous = document.querySelector<HTMLButtonElement>(
      '.app-tabbar [aria-controls="workspace-sidebar"]',
    );
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
    return '/connections';
  }, [location.pathname]);

  const activeRepositoryId = location.pathname.match(/^\/repositories\/([^/]+)/)?.[1];
  useLayoutEffect(() => {
    // Only address changes select a tab. A background status update may render the
    // old route between openRepository() and navigation; it must not undo that selection.
    if (activeRepositoryId) activateRepositoryTab(activeRepositoryId);
  }, [activeRepositoryId, activateRepositoryTab]);
  useLayoutEffect(() => {
    if (!activeRepositoryId) return;
    if (listLoaded && !repositories.some((repo) => repo.id === activeRepositoryId)) {
      const { activeId } = useWorkspaceStore.getState().repositorySession;
      navigate(activeId ? `/repositories/${activeId}` : '/repositories', { replace: true });
    }
  }, [activeRepositoryId, listLoaded, repositories, navigate]);
  const workspaceRepositoryId = isSettings
    ? workspacePath.match(/^\/repositories\/([^/?#]+)/)?.[1]
    : activeRepositoryId;
  const activeRepository =
    openRepositories.find((repo: any) => repo.id === workspaceRepositoryId) ||
    (currentRepo?.id === workspaceRepositoryId ? currentRepo : null);

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

  // Batch closes keep a surviving active tab; otherwise the menu's target takes over.
  const handleCloseRepositories = (ids: string[], targetId: string) => {
    closeRepositories(ids, targetId);
    if (activeRepositoryId && ids.includes(activeRepositoryId))
      navigate(`/repositories/${targetId}`);
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
      if (isActive)
        navigate(nextRepository ? `/repositories/${nextRepository.id}` : '/repositories');
    } catch (err: any) {
      message.error(err.message || `移除仓库“${repo.name}”失败`);
    }
  };

  return (
    <>
      <FeedbackNotice
        source="update-available"
        type="info"
        mode="manual"
        title={
          updateState?.status === 'available' && updateState.background
            ? `Alune v${updateState.latestVersion} 可用`
            : null
        }
        eventKey={updateState?.latestVersion ?? undefined}
        description="新版本已发布，可查看更新说明并下载安装。"
        actionLabel="查看更新"
        onAction={() => openSettings('updates')}
      />
      <FeedbackNotice
        source="workspace-storage"
        title={storageError ? '无法保存外观与工作区设置' : null}
        description={storageError || undefined}
      />
      <div
        className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}${mobileNavOpen ? ' app-shell--mobile-open' : ''}${isSettings ? ' app-shell--settings' : ''}`}
        style={
          {
            '--sidebar-width': `${sidebarWidth}px`,
          } as CSSProperties
        }
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement) shellFocus.current = event.target;
          if (!isSettings && event.target instanceof HTMLElement)
            workspaceFocus.current = event.target;
        }}
      >
        <div className="app-tabbar" inert={compact && mobileNavOpen}>
          {(!sidebarVisible || compact) && (
            <div className="app-tabbar__leading">
              <PanelToggle
                side="left"
                panelName={isSettings ? '设置分类' : undefined}
                expanded={sidebarVisible}
                controls="workspace-sidebar"
                onClick={() =>
                  compact
                    ? setMobileNavOpen(!mobileNavOpen)
                    : updateLayout({ sidebarCollapsed: !collapsed })
                }
              />
              {isSettings && (
                <Button
                  className="settings-back"
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  aria-label="返回工作区"
                  title="返回工作区"
                  onClick={() => navigate(workspacePath)}
                />
              )}
            </div>
          )}
          {isSettings ? (
            <span className="app-tabbar__title">
              设置 <span aria-hidden="true">/</span> <strong>{settingsCategory.name}</strong>
            </span>
          ) : selectedKey === '/repositories' && openRepositories.length > 0 ? (
            <RepositoryTabs
              repositories={openRepositories}
              activeId={activeRepository?.id}
              onSelect={(id) => {
                activateRepositoryTab(id);
                navigate(`/repositories/${id}`);
              }}
              onMove={moveOpenRepository}
              onClose={handleCloseRepository}
              onCloseMany={handleCloseRepositories}
              onOpenRepository={() => navigate('/repositories?open=local')}
            />
          ) : (
            <span className="app-tabbar__title">
              {selectedKey === '/connections' ? '连接' : '仓库'}
            </span>
          )}
          {!isSettings && activeRepositoryId && (
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
          aria-label={isSettings ? '设置导航' : '主导航'}
          role={compact && mobileNavOpen ? 'dialog' : undefined}
          aria-modal={compact && mobileNavOpen ? true : undefined}
          inert={!sidebarVisible}
        >
          <div className="app-sidebar__header">
            <strong>{isSettings ? '设置' : '工作区'}</strong>
            <div className="app-sidebar__header-actions">
              {isSettings ? (
                <Button
                  className="settings-back"
                  type="text"
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  aria-label="返回工作区"
                  title="返回工作区"
                  onClick={() => navigate(workspacePath)}
                />
              ) : (
                <Tooltip title="打开本地仓库" trigger={['hover', 'focus']} placement="bottom">
                  <Button
                    className="workspace-open"
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    aria-label="打开本地仓库"
                    onClick={() => navigate('/repositories?open=local')}
                  />
                </Tooltip>
              )}
              <PanelToggle
                side="left"
                panelName={isSettings ? '设置分类' : undefined}
                expanded
                controls="workspace-sidebar"
                onClick={() =>
                  compact ? setMobileNavOpen(false) : updateLayout({ sidebarCollapsed: true })
                }
              />
            </div>
          </div>
          {isSettings && (
            <div className="app-sidebar__content">
              <SettingsNavigation category={settingsCategory} onSelect={selectSettings} />
            </div>
          )}
          <div
            className="app-sidebar__content"
            ref={workspaceSidebar}
            hidden={isSettings}
            inert={isSettings}
            onScroll={(event) => {
              if (!isSettings) sidebarScroll.current = event.currentTarget.scrollTop;
            }}
          >
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
                    {item.key === '/connections' ? connections.length : repositories.length}
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
                statuses={statuses}
                activeId={activeRepository?.id}
                onOpenRepository={handleOpenRepository}
                onDeleteRepository={handleDeleteRepository}
              />
            </section>
          </div>
        </aside>

        {!compact && !collapsed && (
          <PanelResizeHandle
            className="sidebar-resize-handle"
            label={isSettings ? '调整设置分类宽度' : '调整工作区宽度'}
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
            aria-label={isSettings ? '关闭设置分类' : '关闭导航'}
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {workspaceRepositoryId && (
          <div
            ref={setRepositoryToolbarSlot}
            className="repository-toolbar-row"
            hidden={isSettings}
            inert={compact && mobileNavOpen}
          />
        )}

        <main className="app-main" inert={compact && mobileNavOpen}>
          <div
            className={`app-content${workspaceRepositoryId ? ' app-content--workspace' : ''}`}
            hidden={isSettings}
            inert={isSettings}
          >
            <FeedbackScope
              id={workspacePath}
              label={activeRepository?.name || currentRepo?.name || '仓库'}
              active={!isSettings}
            >
              {workspaceOutlet.current}
            </FeedbackScope>
          </div>
          {isSettings && (
            <FeedbackScope id={location.pathname} label="设置">
              <SettingsCenter
                returnTo={workspacePath}
                updates={updates}
                category={settingsCategory}
                onSelect={selectSettings}
              />
            </FeedbackScope>
          )}
        </main>
        <WorkspaceStatusBar
          repository={activeRepository}
          repositories={openRepositories}
          version={`v${updateState?.currentVersion || __APP_VERSION__}`}
          inert={compact && mobileNavOpen}
          notices={[
            ...(storageError
              ? [
                  {
                    id: 'storage',
                    title: '设置未能保存',
                    description: storageError,
                    tone: 'warning' as const,
                    icon: 'warning' as const,
                  },
                ]
              : []),
            ...(updateState?.status === 'available'
              ? [
                  {
                    id: 'update',
                    title: `Alune v${updateState.latestVersion} 可用`,
                    description: '新版本已发布，可查看更新说明并下载安装。',
                    tone: 'info' as const,
                    icon: 'download' as const,
                    actionLabel: isDesktop ? '查看更新' : undefined,
                    onAction: isDesktop ? () => openSettings('updates') : undefined,
                  },
                ]
              : []),
          ]}
          onSettings={() => openSettings()}
          onUpdates={isDesktop ? () => openSettings('updates') : undefined}
        />
      </div>
    </>
  );
}
