import { useFeedbackMessage } from '@alune/ui';
import type { RepositoryContext } from '@alune/shared';
import { RepositoryContextNotice } from '../components/RepositoryContextNotice';
import { GitOperationNotice } from '../components/GitOperationNotice';
import { RebaseOperationNotice } from '../components/RebaseOperationNotice';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Button, Input, Select } from '@alune/ui';
import { AluneModal, DialogHints, Kbd, useAluneConfirm } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogNote, RepoRow } from '@alune/ui';
import { FeedbackNotice, FeedbackScope } from '@alune/ui';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { gitApi, repositoryApi } from '../api';
import {
  useRepositoryStatusData,
  useRepositoryStore,
  useWorkspaceData,
} from '../stores/repositoryStore';
import type { SelectedRepositoryFile as SelectedFile } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { BranchesView } from '../components/BranchesView';
import { useRepositoryStatus } from '../hooks/useRepositoryStatus';
import { ChangesView } from '../components/ChangesView';
import { DiffViewer } from '../components/DiffViewer';
import { ConflictResolver } from '../components/ConflictResolver';
import { FilesView } from '../components/FilesView';
import { HistoryWorkspace } from '../components/HistoryWorkspace';
import { RemotesView } from '../components/RemotesView';
import { PullRequestsView } from '../components/PullRequestsView';
import { StashesView } from '../components/StashesView';
import { ErrorState, LoadingState, FileIcon } from '@alune/ui';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { CHANGES_MIN } from '../stores/workspaceLayout';
import { PanelResizeHandle } from '../components/PanelResizeHandle';
import { RepositoryToolbar } from '../components/RepositoryToolbar';
import type { RepositoryPanel as Panel, SyncOperation } from '../components/RepositoryToolbar';
import { useSyncStatusStore } from '../stores/syncStatusStore';
import { useTerminalStore } from '../stores/terminalState';
import { RepositoryWorkspaceContext, workspaceListId } from '../hooks/useRepositoryWorkspace';

const panelLabels: Record<Panel, string> = {
  changes: '改动',
  files: '文件',
  history: '提交历史',
  branches: '分支',
  stashes: '储藏',
  remotes: '远程',
  'pull-requests': 'PR/MR',
};

/** Tabs kept mounted at once; the least recently shown one beyond this is unmounted. */
export const MOUNTED_WORKSPACE_LIMIT = 8;

/** Panels in DOM order. The order is fixed: moving a pane would reset its scroll positions. */
const panelOrder = Object.keys(panelLabels) as Panel[];

/**
 * A visited panel stays mounted while another one is shown. While hidden it keeps the
 * props it was last shown with, so refresh tokens and selections reach it when revealed.
 */
const RetainedPanel = memo(
  function RetainedPanel({ children }: { hidden: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  (previous, next) => previous.hidden && next.hidden,
);

type WorkspaceSlots = {
  setRightPanelAvailable: (available: boolean) => void;
  repositoryToolbarSlot: HTMLDivElement | null;
  setTerminalSlot: (slot: HTMLDivElement | null) => void;
};

/**
 * Keeps each visited repository tab mounted so switching back returns to it as it was.
 * Only the active tab is shown and owns the toolbar, terminal and inspector slots.
 */
export function RepositoryWorkspaceHost({
  activeId,
  ...slots
}: WorkspaceSlots & { activeId: string | undefined }) {
  const openRepositories = useRepositoryStore((state) => state.openRepositories);
  const recent = useRef<string[]>([]);
  const order = useRef(new Map<string, number>());
  const open = new Set(openRepositories.map((repo) => repo.id));
  // Derived during render so the activated tab mounts in the same commit; repeatable.
  recent.current = [
    ...recent.current.filter((id) => id !== activeId && open.has(id)),
    ...(activeId ? [activeId] : []),
  ].slice(-MOUNTED_WORKSPACE_LIMIT);
  for (const id of order.current.keys()) if (!recent.current.includes(id)) order.current.delete(id);
  for (const id of recent.current)
    if (!order.current.has(id))
      order.current.set(id, order.current.size ? Math.max(...order.current.values()) + 1 : 0);
  // A stable DOM order: moving a pane would reset the scroll positions inside it.
  const mounted = [...recent.current].sort((a, b) => order.current.get(a)! - order.current.get(b)!);
  return (
    <>
      {mounted.map((id) => (
        <div
          key={id}
          className="workspace-tab-pane"
          hidden={id !== activeId}
          inert={id !== activeId}
        >
          <RepositoryWorkspace id={id} active={id === activeId} {...slots} />
        </div>
      ))}
    </>
  );
}

function RepositoryWorkspace({
  id,
  active,
  setRightPanelAvailable,
  repositoryToolbarSlot,
  setTerminalSlot,
}: WorkspaceSlots & { id: string; active: boolean }) {
  const terminalHeight = useTerminalStore((state) => state.height);
  const message = useFeedbackMessage();
  const confirm = useAluneConfirm();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  // A hidden tab keeps the address it was shown at; another tab's query is not for it.
  const shownLocation = useRef(routerLocation);
  if (active) shownLocation.current = routerLocation;
  const location = shownLocation.current;
  const { layout, compact, changesWidth, changesMax, updateLayout } = useWorkspaceLayout();
  const terminalDock = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const {
    setCurrentRepo,
    activateWorkspace,
    fetchStatus,
    observeRepository,
    fetchLog,
    fetchBranches,
    fetchStashes,
    fetchRemotes,
    fetchDiff,
    preparePartialDiff,
    selectRepositoryFile,
  } = useRepositoryStore.getState();
  const clearDiff = useCallback(() => useRepositoryStore.getState().clearDiff(id), [id]);
  const repository = useRepositoryStore(
    (state) =>
      state.openRepositories.find((repo) => repo.id === id) ||
      (state.currentRepo?.id === id ? state.currentRepo : null) ||
      state.repositories.find((repo) => repo.id === id) ||
      null,
  );
  const status = useRepositoryStatusData(id);
  const {
    diff,
    diffLoading,
    diffRefreshing,
    partialDiff,
    partialDiffEnabled,
    worktreeDiffRevision,
    diffError,
  } = useWorkspaceData(id, (workspace) => ({
    diff: workspace.diff,
    diffLoading: workspace.diffLoading,
    diffRefreshing: workspace.diffRefreshing,
    partialDiff: workspace.partialDiff,
    partialDiffEnabled: workspace.partialDiffEnabled,
    worktreeDiffRevision: workspace.worktreeDiffRevision,
    diffError: workspace.diffError,
  }));
  const { error, errorPanel } = useWorkspaceData(id, (workspace) => ({
    error: workspace.error,
    errorPanel: workspace.errorPanel,
  }));
  const { entry: statusEntry, stale: statusStale } = useRepositoryStatus(id);
  const statusFailed = statusEntry?.phase === 'error';
  // Refresh cached status without inserting a notice that moves the Diff below it.
  useEffect(() => {
    if (active && statusStale && !statusFailed) return observeRepository(id);
  }, [id, active, statusStale, statusFailed, observeRepository]);
  const requestedPanel = new URLSearchParams(location.search).get('panel');
  const [activePanel, setActivePanel] = useState<Panel>(() =>
    requestedPanel === 'pull-requests' ? 'pull-requests' : 'changes',
  );
  const cached = () =>
    useRepositoryStore.getState().repositories.find((repo) => repo.id === id) ||
    useRepositoryStore.getState().openRepositories.find((repo) => repo.id === id);
  // A registration already in memory opens without a loading frame.
  const [loading, setLoading] = useState(() => !cached());
  const [pageError, setPageError] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ repoId: string; hash: string }>();
  const selectedFile = useRepositoryStore((state) => state.selectedFiles[id]) || null;
  const setSelectedFile = useCallback(
    (file: SelectedFile | null) => selectRepositoryFile(id, file),
    [id, selectRepositoryFile],
  );
  // Links such as "create PR/MR" may target a tab that is already open. Returning from
  // settings restores the same query and must not override the panel chosen since.
  const handledSearch = useRef(location.search);
  useEffect(() => {
    if (!active || !location.pathname.startsWith('/repositories/')) return;
    if (location.search === handledSearch.current) return;
    handledSearch.current = location.search;
    if (new URLSearchParams(location.search).get('panel') === 'pull-requests') {
      setHistoryTarget(undefined);
      setActivePanel('pull-requests');
    }
  }, [active, location]);
  const [pushedBranch, setPushedBranch] = useState<{ branch: string; remote?: string } | null>(
    null,
  );
  const [syncing, setSyncing] = useState<SyncOperation | null>(null);
  const [syncingForce, setSyncingForce] = useState(false);
  const [context, setContext] = useState<RepositoryContext | null>(null);
  const [managedRebase, setManagedRebase] = useState<string | null>(null);
  const [syncError, setSyncError] = useState('');
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [syncSelection, setSyncSelection] = useState<{
    operation: SyncOperation;
    force?: boolean;
    tags?: boolean;
  } | null>(null);
  const [remote, setRemote] = useState('origin');
  const [remoteBranch, setRemoteBranch] = useState('');
  const [contextRevision, setContextRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // The files view keeps its own tree; a new token asks it to reload what is on screen.
  const [filesRefresh, setFilesRefresh] = useState(0);
  const [pullRequestsRefresh, setPullRequestsRefresh] = useState(0);
  const startSync = useSyncStatusStore((state) => state.startSync);
  const finishSync = useSyncStatusStore((state) => state.finishSync);

  // Showing a tab makes it current again; its loaded data is kept, only status revalidates.
  useLayoutEffect(() => {
    if (!active) return;
    let cancelled = false;
    setPageError(null);
    activateWorkspace(id);
    const known = cached();
    if (known) {
      setCurrentRepo(known);
      setLoading(false);
      void fetchStatus(id);
      return () => {
        cancelled = true;
      };
    }
    // Opening a workspace needs only its registration. Remote panels load on demand.
    setLoading(true);
    void repositoryApi
      .get(id)
      .then((repo) => {
        if (!cancelled && useWorkspaceStore.getState().repositorySession.activeId === id) {
          setCurrentRepo(repo);
          void fetchStatus(id);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setPageError(err.message || '仓库不可用');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `cached` reads the store when activated; it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, active, activateWorkspace, fetchStatus, setCurrentRepo]);
  // Hiding releases the status slot. A tab shown next claims it again in its own
  // layout effect, which runs after this cleanup in the same commit.
  useLayoutEffect(() => {
    if (active) return () => activateWorkspace();
  }, [active, activateWorkspace]);

  const activeLabel = panelLabels[activePanel];
  const listId = workspaceListId(id);
  const hasInspector = activePanel === 'changes';
  // Derived during render so a newly chosen panel mounts in the same commit; repeatable.
  const visitedPanels = useRef(new Set<Panel>());
  visitedPanels.current.add(activePanel);
  useEffect(() => {
    if (!active) return;
    setRightPanelAvailable(hasInspector);
    return () => setRightPanelAvailable(true);
  }, [active, hasInspector, setRightPanelAvailable]);
  // Each tab has its own dock; the terminal moves into the shown one.
  const activeRef = useRef(active);
  activeRef.current = active;
  const terminalDockRef = useCallback(
    (node: HTMLDivElement | null) => {
      terminalDock.current = node;
      if (activeRef.current) setTerminalSlot(node);
    },
    [setTerminalSlot],
  );
  useLayoutEffect(() => {
    if (!active) return;
    setTerminalSlot(terminalDock.current);
    return () => setTerminalSlot(null);
  }, [active, setTerminalSlot]);

  useEffect(() => {
    if (active && compact && layout.changesCollapsed) backButton.current?.focus();
  }, [active, compact, layout.changesCollapsed]);

  const returnToList = () => {
    if (compact) updateLayout({ changesCollapsed: false });
    requestAnimationFrame(() => {
      if (returnTarget.current?.isConnected && returnTarget.current.getClientRects().length)
        returnTarget.current.focus();
      else document.getElementById(listId)?.querySelector<HTMLElement>('button, input')?.focus();
    });
  };

  useLayoutEffect(() => {
    // Wait for the registration before reconciling this tab's remembered selection.
    if (loading || !selectedFile || !status) return;
    const exact = status.files.find(
      (file: SelectedFile) =>
        file.path === selectedFile.path && file.staged === selectedFile.staged,
    );
    const next =
      exact || status.files.find((file: SelectedFile) => file.path === selectedFile.path);
    if (!next) {
      setSelectedFile(null);
      clearDiff();
      // Focus stays in another panel that is in front.
      if (compact && activePanel === 'changes') returnToList();
    } else if (next.staged !== selectedFile.staged || next.status !== selectedFile.status)
      setSelectedFile({ path: next.path, staged: next.staged, status: next.status });
  }, [status, selectedFile, compact, clearDiff, loading, setSelectedFile, activePanel]);

  // Status polling replaces objects even when this comparison has not changed.
  const selectedStatus = status?.files.find(
    (file) => file.path === selectedFile?.path && file.staged === selectedFile?.staged,
  );
  const selectedStatusKey = selectedStatus
    ? JSON.stringify([selectedStatus.status, selectedStatus.oldPath, selectedStatus.conflict])
    : null;
  // Conflicted files open the resolver, which reads the worktree file itself.
  const selectedConflict = selectedStatus?.conflicted ? selectedStatus : null;

  useLayoutEffect(() => {
    if (loading || activePanel !== 'changes') return;
    if (id && selectedFile && selectedStatusKey && !selectedConflict) {
      void fetchDiff(id, { file: selectedFile.path, staged: selectedFile.staged });
    } else clearDiff();
  }, [
    id,
    loading,
    activePanel,
    selectedFile?.path,
    selectedFile?.staged,
    selectedStatusKey,
    selectedConflict?.conflicted,
    status?.branch,
    worktreeDiffRevision,
    fetchDiff,
    clearDiff,
  ]);

  // The inspector stays mounted behind other panels and revalidates when shown again.
  // History reads its own Diff slot, so only an unmounted tab clears this one.
  useLayoutEffect(() => clearDiff, [clearDiff]);

  // A panel shown again keeps its state; its lists revalidate as they did on remount.
  // History keeps its loaded log, as it always has; files follow their refresh token.
  const shownPanels = useRef(new Set<Panel>());
  useEffect(() => {
    if (!shownPanels.current.has(activePanel)) {
      shownPanels.current.add(activePanel);
      return;
    }
    if (activePanel === 'branches') void fetchBranches(id);
    else if (activePanel === 'stashes') void fetchStashes(id);
    else if (activePanel === 'remotes') void fetchRemotes(id);
    else if (activePanel === 'pull-requests') setPullRequestsRefresh((token) => token + 1);
    // Runs once per panel change; the fetchers are stable store actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel]);

  const showHistory = (path: string, file: boolean) => {
    setHistoryTarget(undefined);
    setActivePanel('history');
    void useRepositoryStore
      .getState()
      .setLogFilter(id, { file: path, ...(file ? { follow: true } : {}) });
  };

  // Every panel returns as it was left, including a file open in the compact inspector.
  const selectPanel = (panel: Panel) => {
    setHistoryTarget(undefined);
    setActivePanel(panel);
    if (compact && panel === 'changes' && !selectedFile) updateLayout({ changesCollapsed: false });
  };

  // Explicit refreshes update the preview too; opening uses fetchStatus directly.
  const handleRefresh = async (afterMutation = true) => {
    setContextRevision((value) => value + 1);
    if (activePanel === 'files') setFilesRefresh((token) => token + 1);
    if (activePanel === 'pull-requests') setPullRequestsRefresh((token) => token + 1);
    await fetchStatus(id, afterMutation);
    if (activePanel === 'history') await fetchLog(id);
    if (activePanel === 'branches') await fetchBranches(id);
    if (activePanel === 'stashes') await fetchStashes(id);
    if (activePanel === 'remotes') await fetchRemotes(id);
  };

  const refreshFromToolbar = async () => {
    setRefreshing(true);
    try {
      await handleRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const runSync = async (
    operation: SyncOperation,
    options?: {
      force?: boolean;
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
      tags?: boolean;
    },
  ) => {
    if (syncing) return;
    const force = Boolean(options?.force);
    const label =
      operation === 'fetch' ? '获取' : operation === 'pull' ? '拉取' : force ? '强制推送' : '推送';
    setSyncError('');
    setSyncing(operation);
    setSyncingForce(force);
    startSync(id, operation, { force });
    try {
      if (operation === 'push')
        await gitApi.push(
          id,
          options?.remote,
          options?.branch,
          force,
          options?.setUpstream,
          options?.tags,
        );
      else await gitApi[operation](id, options?.remote, options?.branch);
      if (operation === 'push' && !options?.tags && (options?.branch || status?.branch))
        setPushedBranch({ branch: options?.branch || status!.branch, remote: options?.remote });
      await handleRefresh(true);
    } catch (err: any) {
      setSyncError(err.message || `${label}失败`);
      await handleRefresh(true);
    } finally {
      setSyncing(null);
      setSyncingForce(false);
      finishSync(id);
    }
  };

  const requestSync = async (
    operation: SyncOperation,
    options?: { force?: boolean; tags?: boolean },
  ) => {
    if (syncing) return;
    setSyncError('');
    setSyncAttempt((value) => value + 1);
    let current = context;
    try {
      current = await repositoryApi.context(id);
      setContext(current);
    } catch (failure: any) {
      setSyncError(failure.message);
      return;
    }
    if (!current.remotes.length) {
      selectPanel('remotes');
      message.info('请先添加远程地址。');
      return;
    }
    if (operation !== 'fetch' && current.unborn) {
      message.info('请先创建首次提交。');
      return;
    }
    const execute = () => {
      if (operation !== 'fetch' && !options?.tags && !current.upstream) {
        if (!status?.branch || status.branch === '(detached)') {
          message.warning('请先创建或切换到一个本地分支。');
          return;
        }
        setRemote(
          current.remotes.find((item) => item.name === 'origin')?.name || current.remotes[0].name,
        );
        setRemoteBranch(status.branch);
        setSyncSelection({ operation, ...options });
      } else void runSync(operation, options);
    };
    if (options?.force) {
      const branch = status?.branch || '';
      void confirm({
        level: 2,
        glyph: 'cloud-up',
        eyebrow: {
          label: repository?.source === 'local' ? '本机' : 'SSH',
          detail: [repository?.name, branch].filter(Boolean).join(' · '),
        },
        levelLabel: '覆盖远程',
        title: '强制推送当前分支？',
        description: '将更新远程历史，覆盖上次获取后已知的远程提交。',
        content: (
          <>
            <DialogCard>
              <RepoRow name={repository?.name} path={repository?.path}>
                {current.upstream ? (
                  <span className="dlg-badge is-mono">{current.upstream}</span>
                ) : null}
              </RepoRow>
            </DialogCard>
            <DialogNote quiet icon="shield">
              <p>
                使用 <code>--force-with-lease</code>：若远程又有变化，Git 会拒绝此次推送。
              </p>
            </DialogNote>
          </>
        ),
        typedConfirm: branch
          ? {
              value: branch,
              icon: 'branch',
              mismatch: '与当前分支名不一致',
              match: '分支名一致',
            }
          : undefined,
        hints: (
          <DialogHints tone="warn">
            <span>
              <DialogIcon name="warning" />
              覆盖远程历史
            </span>
          </DialogHints>
        ),
        okText: '确认强制推送',
        okIcon: 'cloud-up',
        onOk: execute,
      });
    } else execute();
  };

  const handleSelectFile = (file: any) => {
    returnTarget.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (compact) updateLayout({ changesCollapsed: true });
    setSelectedFile({ path: file.path, status: file.status, staged: file.staged });
  };

  const detailTitle = useMemo(() => selectedFile?.path || '检查器', [selectedFile]);

  const workspace = useMemo(() => ({ repoId: id, active, location }), [id, active, location]);
  // Panels behind the one in front read as inactive, like hidden tabs.
  const hiddenPanel = useMemo(() => ({ ...workspace, active: false }), [workspace]);

  if (pageError || (!repository && error))
    return (
      <ErrorState
        title="仓库不可用"
        description={pageError || error}
        onRetry={() => window.location.reload()}
      />
    );
  if (loading) return <LoadingState label="正在打开仓库工作区…" />;
  if (!repository)
    return (
      <ErrorState
        title="未找到仓库"
        description="此仓库可能已被移除，或当前无法访问。"
        onRetry={() => navigate('/repositories')}
      />
    );

  const renderPanel = (panel: Panel) => {
    if (panel === 'changes')
      return (
        <ChangesView
          repoId={id}
          managedRebase={managedRebase === id}
          onRefresh={handleRefresh}
          onSelectFile={handleSelectFile}
          selectedFile={selectedFile}
          onShowHistory={showHistory}
          onFileChanged={(path) => {
            setFilesRefresh((value) => value + 1);
            if (selectedFile?.path === path) {
              setSelectedFile(null);
              clearDiff();
              if (compact) returnToList();
            }
          }}
        />
      );
    if (panel === 'files')
      return (
        <FilesView
          repoId={id}
          refreshToken={filesRefresh}
          onShowHistory={showHistory}
          onFileChanged={(path) => {
            if (selectedFile?.path === path) {
              setSelectedFile(null);
              clearDiff();
            }
          }}
          onSelectCommit={(hash) => {
            setHistoryTarget({ repoId: id, hash });
            setActivePanel('history');
          }}
          gitFiles={statusEntry?.data?.files}
        />
      );
    if (panel === 'pull-requests')
      return <PullRequestsView repoId={id} refreshToken={pullRequestsRefresh} />;
    if (panel === 'history')
      return (
        <HistoryWorkspace
          repoId={id}
          targetHash={historyTarget?.repoId === id ? historyTarget.hash : undefined}
        />
      );
    if (panel === 'branches')
      return (
        <BranchesView
          repoId={id}
          refreshToken={contextRevision}
          onRefresh={() => void handleRefresh(true)}
        />
      );
    if (panel === 'stashes')
      return <StashesView repoId={id} onRefresh={() => void handleRefresh(true)} />;
    return <RemotesView repoId={id} onRefresh={() => void handleRefresh()} />;
  };

  const retain = (panel: Panel, content: ReactNode) => (
    <RepositoryWorkspaceContext.Provider value={panel === activePanel ? workspace : hiddenPanel}>
      <RetainedPanel hidden={panel !== activePanel}>{content}</RetainedPanel>
    </RepositoryWorkspaceContext.Provider>
  );

  return (
    <RepositoryWorkspaceContext.Provider value={workspace}>
      <FeedbackScope id={`/repositories/${id}`} label={repository.name || '仓库'} active={active}>
        <div
          className={`workspace-page${compact ? ' workspace-page--compact' : ''}${compact && hasInspector && layout.changesCollapsed ? ' workspace-page--inspecting' : ''}`}
          style={{ '--changes-width': `${changesWidth}px` } as CSSProperties}
        >
          {active &&
            repositoryToolbarSlot &&
            createPortal(
              <RepositoryToolbar
                repoId={id}
                status={status}
                activePanel={activePanel}
                syncing={syncing}
                syncingForce={syncingForce}
                refreshing={refreshing}
                onSelect={selectPanel}
                onSync={(operation, options) => void requestSync(operation, options)}
                onRefresh={() => void refreshFromToolbar()}
                onBranchSwitched={() => void handleRefresh(true)}
              />,
              repositoryToolbarSlot,
            )}
          <RepositoryContextNotice
            repoId={id}
            revision={`${contextRevision}:${status?.branch || ''}:${worktreeDiffRevision}`}
            onContext={setContext}
            onRemotes={() => selectPanel('remotes')}
            onRefresh={() => void handleRefresh()}
          />
          {pushedBranch && (
            <div className="repository-push-followup" role="status">
              <span>{pushedBranch.branch} 已推送</span>
              <Button
                type="link"
                onClick={() => {
                  navigate(
                    `/repositories/${id}?${new URLSearchParams({ panel: 'pull-requests', createPr: '1', sourceBranch: pushedBranch.branch, ...(pushedBranch.remote ? { remote: pushedBranch.remote } : {}) })}`,
                  );
                  setPushedBranch(null);
                }}
              >
                创建 PR/MR
              </Button>
              <Button type="text" aria-label="关闭推送提示" onClick={() => setPushedBranch(null)}>
                关闭
              </Button>
            </div>
          )}
          <GitOperationNotice key={id} repoId={id} onFinished={() => void handleRefresh()} />
          <RebaseOperationNotice
            key={`rebase:${id}`}
            repoId={id}
            onFinished={() => void handleRefresh()}
            onManagedChange={(managed) => setManagedRebase(managed ? id : null)}
          />
          <FeedbackNotice
            source="git-sync"
            title={syncError ? 'Git 操作未完成' : null}
            description={syncError}
            eventKey={syncAttempt}
            actionLabel="刷新状态"
            onAction={async () => {
              await handleRefresh();
              setSyncError('');
            }}
          />
          <FeedbackNotice
            source="repository-status"
            title={statusFailed ? '无法读取仓库状态' : null}
            description={statusEntry?.error}
            mode="notification"
            resetOnClear={statusEntry?.phase === 'success'}
            actionLabel="重试状态"
            busy={statusEntry?.phase === 'loading' || statusEntry?.phase === 'queued'}
            onAction={() => fetchStatus(id)}
          />
          <FeedbackNotice
            source={`repository-panel:${activePanel}`}
            title={error && errorPanel === activePanel ? `${activeLabel}读取失败` : null}
            description={error || undefined}
            actionLabel="重试"
            onAction={() => handleRefresh(false)}
          />
          <AluneModal
            open={active && !!syncSelection}
            glyph={syncSelection?.operation === 'push' ? 'cloud-up' : 'cloud-down'}
            eyebrow={{
              label: syncSelection?.operation === 'push' ? '推送' : '拉取',
              detail: [repository?.name, status?.branch].filter(Boolean).join(' · '),
            }}
            title={syncSelection?.operation === 'push' ? '设置上游并推送' : '选择拉取来源'}
            description="当前分支还没有上游。确认远程和分支后执行。"
            hints={
              <DialogHints>
                <span>
                  <Kbd>↵</Kbd> 执行
                </span>
                <i />
                <span>
                  <Kbd>Esc</Kbd> 取消
                </span>
              </DialogHints>
            }
            onCancel={() => setSyncSelection(null)}
            okText={syncSelection?.operation === 'push' ? '设置并推送' : '拉取'}
            okDisabled={!remote || !remoteBranch.trim()}
            initialFocus="field"
            onOk={() => {
              if (!syncSelection) return;
              const selected = syncSelection;
              setSyncSelection(null);
              void runSync(selected.operation, {
                ...selected,
                remote,
                branch: remoteBranch.trim(),
                setUpstream: selected.operation === 'push',
              });
            }}
          >
            <div className="dlg-fld-row">
              <label className="dlg-fld">
                <span className="dlg-fld-label">远程</span>
                <Select
                  id="git-sync-remote"
                  aria-label="远程"
                  prefix={<DialogIcon name="globe" />}
                  value={remote}
                  onChange={setRemote}
                  options={context?.remotes.map((item) => ({ value: item.name, label: item.name }))}
                />
              </label>
              <label className="dlg-fld">
                <span className="dlg-fld-label">远程分支</span>
                <Input
                  id="git-sync-branch"
                  className="dlg-mono-input"
                  value={remoteBranch}
                  autoComplete="off"
                  spellCheck={false}
                  data-autofocus
                  onChange={(event) => setRemoteBranch(event.target.value)}
                />
              </label>
            </div>
            <DialogCard>
              <div className="dlg-card-row">
                {syncSelection?.operation === 'push' ? (
                  <span className="dlg-path">
                    <b>{status?.branch}</b> → {remote}/<b>{remoteBranch.trim()}</b>
                  </span>
                ) : (
                  <span className="dlg-path">
                    {remote}/<b>{remoteBranch.trim()}</b> → <b>{status?.branch}</b>
                  </span>
                )}
                <span className="dlg-badge is-mono" style={{ marginLeft: 'auto' }}>
                  {syncSelection?.operation === 'push' ? '--set-upstream' : '--no-edit'}
                </span>
              </div>
            </DialogCard>
          </AluneModal>
          <div
            className={
              'workspace-body' +
              (!hasInspector ? ' workspace-body--single' : '') +
              (hasInspector && layout.changesCollapsed ? ' workspace-body--right-hidden' : '')
            }
          >
            <div className="workspace-center">
              {visitedPanels.current.has('changes') && (
                <aside
                  className="workspace-panel workspace-panel--detail"
                  aria-label="仓库详情"
                  hidden={!hasInspector}
                  inert={!hasInspector}
                >
                  {retain(
                    'changes',
                    <>
                      {compact && (
                        <div className="inspector-heading">
                          <Button
                            ref={backButton}
                            aria-label="返回列表"
                            type="text"
                            size="small"
                            icon={<ArrowLeftOutlined />}
                            onClick={returnToList}
                          >
                            返回列表
                          </Button>
                        </div>
                      )}
                      {selectedFile && selectedConflict ? (
                        <ConflictResolver
                          key={`${id}:${selectedFile.path}`}
                          repoId={id}
                          file={selectedConflict}
                          operation={status?.operation}
                          revision={`${worktreeDiffRevision}:${selectedStatusKey}`}
                          onChanged={() => handleRefresh(true)}
                          onFocus={() =>
                            updateLayout({ sidebarCollapsed: true, changesCollapsed: true })
                          }
                          onClose={() => {
                            setSelectedFile(null);
                            returnToList();
                          }}
                        />
                      ) : selectedFile ? (
                        <DiffViewer
                          diff={diff}
                          partial={
                            partialDiff
                              ? {
                                  revision: partialDiff.revision,
                                  unavailableReason: partialDiff.unavailableReason,
                                  staged: selectedFile.staged,
                                  refreshing: diffRefreshing,
                                  preparing: diffRefreshing && partialDiffEnabled,
                                  onEnable: () =>
                                    preparePartialDiff(id, {
                                      file: selectedFile.path,
                                      staged: selectedFile.staged,
                                    }),
                                  onChanged: () => fetchStatus(id, true),
                                }
                              : undefined
                          }
                          loading={diffLoading}
                          comparisonKey={JSON.stringify([
                            id,
                            selectedFile.path,
                            selectedFile.staged,
                          ])}
                          repoId={id}
                          filePath={selectedFile.path}
                          imageRequest={{ staged: selectedFile.staged }}
                          error={diffError}
                          title={detailTitle}
                          subtitle={
                            selectedFile.staged
                              ? selectedFile.status === 'added'
                                ? '已暂存 · 空版本 → 暂存区'
                                : '已暂存 · HEAD → 暂存区'
                              : selectedFile.status === 'untracked' ||
                                  selectedFile.status === 'added'
                                ? '未暂存 · 空版本 → 工作区'
                                : '未暂存 · 暂存区 → 工作区'
                          }
                          onFocus={() =>
                            updateLayout({ sidebarCollapsed: true, changesCollapsed: true })
                          }
                          onClose={() => {
                            setSelectedFile(null);
                            returnToList();
                          }}
                        />
                      ) : (
                        <div className="workspace-detail workspace-detail--empty">
                          <div className="detail-empty-icon">
                            <FileIcon path="preview.ts" />
                          </div>
                          <h3>选择文件以查看差异</h3>
                          <p>选择“改动”中的文件或“提交历史”中的提交，以查看差异和元数据。</p>
                        </div>
                      )}
                    </>,
                  )}
                </aside>
              )}
              {panelOrder
                .filter((panel) => panel !== 'changes' && visitedPanels.current.has(panel))
                .map((panel) => (
                  <div
                    key={panel}
                    id={panel === activePanel ? listId : undefined}
                    className="workspace-main-panel"
                    aria-label={panelLabels[panel]}
                    hidden={panel !== activePanel}
                    inert={panel !== activePanel}
                  >
                    {retain(panel, renderPanel(panel))}
                  </div>
                ))}
              <div
                className="terminal-dock"
                ref={terminalDockRef}
                style={{ '--terminal-height': `${terminalHeight}px` } as CSSProperties}
              />
            </div>
            {hasInspector && !compact && !layout.changesCollapsed && (
              <PanelResizeHandle
                label="调整右侧面板宽度"
                controls={listId}
                side="right"
                value={changesWidth}
                min={CHANGES_MIN}
                max={changesMax}
                onChange={(width) => updateLayout({ changesWidth: width })}
              />
            )}
            {visitedPanels.current.has('changes') && (
              <aside
                id={hasInspector ? listId : undefined}
                className="workspace-main-panel"
                aria-label={panelLabels.changes}
                hidden={!hasInspector}
                inert={!hasInspector || layout.changesCollapsed}
              >
                {retain('changes', renderPanel('changes'))}
              </aside>
            )}
          </div>
        </div>
      </FeedbackScope>
    </RepositoryWorkspaceContext.Provider>
  );
}
