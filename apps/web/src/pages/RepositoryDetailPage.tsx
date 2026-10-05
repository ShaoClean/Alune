import { useFeedbackMessage } from '@alune/ui';
import type { RepositoryContext } from '@alune/shared';
import { RepositoryContextNotice } from '../components/RepositoryContextNotice';
import { GitOperationNotice } from '../components/GitOperationNotice';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Button, Input, Select } from '@alune/ui';
import { AluneModal, DialogHints, Kbd, useAluneConfirm } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogNote, RepoRow } from '@alune/ui';
import { FeedbackNotice } from '@alune/ui';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { BranchesView } from '../components/BranchesView';
import { useRepositoryStatus } from '../hooks/useRepositoryStatus';
import { ChangesView } from '../components/ChangesView';
import { DiffViewer } from '../components/DiffViewer';
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

type SelectedFile = { path: string; status: string; staged: boolean };
const panelLabels: Record<Panel, string> = {
  changes: '改动',
  files: '文件',
  history: '提交历史',
  branches: '分支',
  stashes: '储藏',
  remotes: '远程',
  'pull-requests': 'PR/MR',
};

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <RepositoryWorkspace key={id} id={id} />;
}

function RepositoryWorkspace({ id }: { id: string | undefined }) {
  const terminalHeight = useTerminalStore((state) => state.height);
  const message = useFeedbackMessage();
  const confirm = useAluneConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const { setRightPanelAvailable, repositoryToolbarSlot, setTerminalSlot } = useOutletContext<{
    setRightPanelAvailable: (available: boolean) => void;
    repositoryToolbarSlot: HTMLDivElement | null;
    setTerminalSlot: (slot: HTMLDivElement | null) => void;
  }>();
  const { layout, compact, changesWidth, changesMax, updateLayout } = useWorkspaceLayout();
  const backButton = useRef<HTMLButtonElement>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const {
    currentRepo,
    openRepositories,
    status,
    diff,
    diffLoading,
    worktreeDiffRevision,
    diffError,
    setCurrentRepo,
    resetWorkspace,
    fetchStatus,
    observeRepository,
    fetchLog,
    fetchBranches,
    fetchStashes,
    fetchRemotes,
    fetchDiff,
    clearDiff,
    error,
    errorPanel,
  } = useRepositoryStore();
  const { entry: statusEntry, stale: statusStale } = useRepositoryStatus(id || '');
  const statusFailed = statusEntry?.phase === 'error';
  // Refresh cached status without inserting a notice that moves the Diff below it.
  useEffect(() => {
    if (id && statusStale && !statusFailed) return observeRepository(id);
  }, [id, statusStale, statusFailed, observeRepository]);
  const [activePanel, setActivePanel] = useState<Panel>(() =>
    new URLSearchParams(location.search).get('panel') === 'pull-requests'
      ? 'pull-requests'
      : 'changes',
  );
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [syncing, setSyncing] = useState<SyncOperation | null>(null);
  const [syncingForce, setSyncingForce] = useState(false);
  const [context, setContext] = useState<RepositoryContext | null>(null);
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

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setSelectedFile(null);
    resetWorkspace(id);
    const cached =
      useRepositoryStore.getState().repositories.find((repo) => repo.id === id) ||
      useRepositoryStore.getState().openRepositories.find((repo) => repo.id === id);
    // Opening a workspace needs only its registration. Remote panels load on demand.
    void (cached ? Promise.resolve(cached) : repositoryApi.get(id))
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
      resetWorkspace();
    };
  }, [id, fetchStatus, resetWorkspace, setCurrentRepo]);

  const repository =
    currentRepo?.id === id
      ? currentRepo
      : openRepositories.find((repo: any) => repo.id === id) || null;
  const switchingRepository = currentRepo?.id !== id;
  const activeLabel = panelLabels[activePanel];
  const hasInspector = activePanel === 'changes';
  useEffect(() => {
    setRightPanelAvailable(hasInspector);
    return () => setRightPanelAvailable(true);
  }, [hasInspector, setRightPanelAvailable]);

  useEffect(() => {
    if (compact && layout.changesCollapsed) backButton.current?.focus();
  }, [compact, layout.changesCollapsed]);

  const returnToList = () => {
    if (compact) updateLayout({ changesCollapsed: false });
    requestAnimationFrame(() => {
      if (returnTarget.current?.isConnected && returnTarget.current.getClientRects().length)
        returnTarget.current.focus();
      else
        document
          .querySelector<HTMLElement>('#workspace-list button, #workspace-list input')
          ?.focus();
    });
  };

  useLayoutEffect(() => {
    if (!selectedFile || !status) return;
    const exact = status.files.find(
      (file: SelectedFile) =>
        file.path === selectedFile.path && file.staged === selectedFile.staged,
    );
    const next =
      exact || status.files.find((file: SelectedFile) => file.path === selectedFile.path);
    if (!next) {
      setSelectedFile(null);
      clearDiff();
      if (compact) returnToList();
    } else if (next.staged !== selectedFile.staged || next.status !== selectedFile.status)
      setSelectedFile({ path: next.path, staged: next.staged, status: next.status });
  }, [status, selectedFile, compact, clearDiff]);

  // Status polling replaces objects even when this comparison has not changed.
  const selectedStatus = status?.files.find(
    (file) => file.path === selectedFile?.path && file.staged === selectedFile?.staged,
  );
  const selectedStatusKey = selectedStatus
    ? JSON.stringify([selectedStatus.status, selectedStatus.oldPath])
    : null;

  useLayoutEffect(() => {
    if (activePanel !== 'changes') return;
    if (id && selectedFile && selectedStatusKey) {
      void fetchDiff(id, { file: selectedFile.path, staged: selectedFile.staged });
    } else clearDiff();
  }, [
    id,
    activePanel,
    selectedFile?.path,
    selectedFile?.staged,
    selectedStatusKey,
    status?.branch,
    worktreeDiffRevision,
    fetchDiff,
    clearDiff,
  ]);

  // Clear only when leaving the view, so a refresh can retain its mounted content.
  useLayoutEffect(() => clearDiff, [id, activePanel, clearDiff]);

  const selectPanel = (panel: Panel) => {
    setActivePanel(panel);
    setSelectedFile(null);
    if (compact && panel === 'changes') updateLayout({ changesCollapsed: false });
  };

  // Explicit refreshes update the preview too; opening uses fetchStatus directly.
  const handleRefresh = async (afterMutation = true) => {
    if (!id) return;
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
    if (!id || syncing) return;
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
    if (!id || syncing) return;
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
          label: currentRepo?.source === 'local' ? '本机' : 'SSH',
          detail: [currentRepo?.name, branch].filter(Boolean).join(' · '),
        },
        levelLabel: '覆盖远程',
        title: '强制推送当前分支？',
        description: '将更新远程历史，覆盖上次获取后已知的远程提交。',
        content: (
          <>
            <DialogCard>
              <RepoRow name={currentRepo?.name} path={currentRepo?.path}>
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

  if (pageError || (!repository && error))
    return (
      <ErrorState
        title="仓库不可用"
        description={pageError || error}
        onRetry={() => window.location.reload()}
      />
    );
  if (loading || switchingRepository) return <LoadingState label="正在打开仓库工作区…" />;
  if (!repository)
    return (
      <ErrorState
        title="未找到仓库"
        description="此仓库可能已被移除，或当前无法访问。"
        onRetry={() => navigate('/repositories')}
      />
    );

  const renderPanel = () => {
    if (!id) return null;
    if (activePanel === 'changes')
      return (
        <ChangesView
          key={id}
          repoId={id}
          onRefresh={handleRefresh}
          onSelectFile={handleSelectFile}
          selectedFile={selectedFile}
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
    if (activePanel === 'files')
      return (
        <FilesView
          key={id}
          repoId={id}
          refreshToken={filesRefresh}
          onFileChanged={(path) => {
            if (selectedFile?.path === path) {
              setSelectedFile(null);
              clearDiff();
            }
          }}
          gitFiles={statusEntry?.data?.files}
        />
      );
    if (activePanel === 'pull-requests')
      return <PullRequestsView key={id} repoId={id} refreshToken={pullRequestsRefresh} />;
    if (activePanel === 'history') return <HistoryWorkspace repoId={id} />;
    if (activePanel === 'branches')
      return <BranchesView key={id} repoId={id} refreshToken={contextRevision} onRefresh={() => void handleRefresh(true)} />;
    if (activePanel === 'stashes')
      return <StashesView repoId={id} onRefresh={() => void handleRefresh(true)} />;
    return <RemotesView repoId={id} onRefresh={() => void handleRefresh()} />;
  };

  return (
    <div
      className={`workspace-page${compact ? ' workspace-page--compact' : ''}${compact && hasInspector && layout.changesCollapsed ? ' workspace-page--inspecting' : ''}`}
      style={{ '--changes-width': `${changesWidth}px` } as CSSProperties}
    >
      {repositoryToolbarSlot &&
        createPortal(
          <RepositoryToolbar
            repoId={id!}
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
        repoId={id!}
        revision={`${contextRevision}:${status?.branch || ''}:${worktreeDiffRevision}`}
        onContext={setContext}
        onRemotes={() => selectPanel('remotes')}
        onRefresh={() => void handleRefresh()}
      />
      <GitOperationNotice key={id} repoId={id!} onFinished={() => void handleRefresh()} />
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
        onAction={() => fetchStatus(id!)}
      />
      <FeedbackNotice
        source={`repository-panel:${activePanel}`}
        title={error && errorPanel === activePanel ? `${activeLabel}读取失败` : null}
        description={error || undefined}
        actionLabel="重试"
        onAction={() => handleRefresh(false)}
      />
      <AluneModal
        open={!!syncSelection}
        glyph={syncSelection?.operation === 'push' ? 'cloud-up' : 'cloud-down'}
        eyebrow={{
          label: syncSelection?.operation === 'push' ? '推送' : '拉取',
          detail: [currentRepo?.name, status?.branch].filter(Boolean).join(' · '),
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
          {hasInspector ? (
            <aside className="workspace-panel workspace-panel--detail" aria-label="仓库详情">
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
              {selectedFile ? (
                <DiffViewer
                  diff={diff}
                  loading={diffLoading}
                  comparisonKey={JSON.stringify([id, selectedFile.path, selectedFile.staged])}
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
                      : selectedFile.status === 'untracked' || selectedFile.status === 'added'
                        ? '未暂存 · 空版本 → 工作区'
                        : '未暂存 · 暂存区 → 工作区'
                  }
                  onFocus={() => updateLayout({ sidebarCollapsed: true, changesCollapsed: true })}
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
            </aside>
          ) : (
            <div id="workspace-list" className="workspace-main-panel" aria-label={activeLabel}>
              {renderPanel()}
            </div>
          )}
          <div
            className="terminal-dock"
            ref={setTerminalSlot}
            style={{ '--terminal-height': `${terminalHeight}px` } as CSSProperties}
          />
        </div>
        {hasInspector && !compact && !layout.changesCollapsed && (
          <PanelResizeHandle
            label="调整右侧面板宽度"
            controls="workspace-list"
            side="right"
            value={changesWidth}
            min={CHANGES_MIN}
            max={changesMax}
            onChange={(width) => updateLayout({ changesWidth: width })}
          />
        )}
        {hasInspector && (
          <aside
            id="workspace-list"
            className="workspace-main-panel"
            aria-label={activeLabel}
            inert={layout.changesCollapsed}
          >
            {renderPanel()}
          </aside>
        )}
      </div>
    </div>
  );
}
