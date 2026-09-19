import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Button, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { BranchesView } from '../components/BranchesView';
import { RepositoryStatusIndicator } from '../components/RepositoryStatusIndicator';
import { useRepositoryStatus } from '../hooks/useRepositoryStatus';
import { ChangesView } from '../components/ChangesView';
import { DiffViewer } from '../components/DiffViewer';
import { HistoryWorkspace } from '../components/HistoryWorkspace';
import { RemotesView } from '../components/RemotesView';
import { StashesView } from '../components/StashesView';
import { ErrorState, LoadingState, FileIcon } from '../components/ui';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { CHANGES_MIN } from '../stores/workspaceLayout';
import { PanelResizeHandle } from '../components/PanelResizeHandle';
import { RepositoryToolbar } from '../components/RepositoryToolbar';
import type { RepositoryPanel as Panel, SyncOperation } from '../components/RepositoryToolbar';
import { useSyncStatusStore } from '../stores/syncStatusStore';

type SelectedFile = { path: string; status: string; staged: boolean };
const panelLabels: Record<Panel, string> = {
  changes: '改动',
  history: '提交历史',
  branches: '分支',
  stashes: '储藏',
  remotes: '远程',
};

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <RepositoryWorkspace key={id} id={id} />;
}

function RepositoryWorkspace({ id }: { id: string | undefined }) {
  const navigate = useNavigate();
  const { setRightPanelAvailable, repositoryToolbarSlot } = useOutletContext<{
    setRightPanelAvailable: (available: boolean) => void;
    repositoryToolbarSlot: HTMLDivElement | null;
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
  } = useRepositoryStore();
  const { entry: statusEntry, stale: statusStale } = useRepositoryStatus(id || '');
  const statusFailed = statusEntry?.phase === 'error';
  // Refresh cached status without inserting a notice that moves the Diff below it.
  useEffect(() => {
    if (id && statusStale && !statusFailed) return observeRepository(id);
  }, [id, statusStale, statusFailed, observeRepository]);
  const [activePanel, setActivePanel] = useState<Panel>('changes');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [syncing, setSyncing] = useState<SyncOperation | null>(null);
  const [syncingForce, setSyncingForce] = useState(false);
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
        if (!cancelled) {
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
    await fetchStatus(id, afterMutation);
    if (activePanel === 'history') await fetchLog(id);
    if (activePanel === 'branches') await fetchBranches(id);
    if (activePanel === 'stashes') await fetchStashes(id);
    if (activePanel === 'remotes') await fetchRemotes(id);
  };

  const runSync = async (operation: SyncOperation, options?: { force?: boolean }) => {
    if (!id || syncing) return;
    const force = Boolean(options?.force);
    const label =
      operation === 'fetch' ? '获取' : operation === 'pull' ? '拉取' : force ? '强制推送' : '推送';
    setSyncing(operation);
    setSyncingForce(force);
    startSync(id, operation, { force });
    try {
      if (operation === 'push') await gitApi.push(id, undefined, undefined, force);
      else await gitApi[operation](id);
      message.success(`${label}完成`);
      await handleRefresh(true);
    } catch (err: any) {
      message.error(err.message || `${label}失败`);
    } finally {
      setSyncing(null);
      setSyncingForce(false);
      finishSync(id);
    }
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
            if (selectedFile?.path === path) {
              setSelectedFile(null);
              clearDiff();
              if (compact) returnToList();
            }
          }}
        />
      );
    if (activePanel === 'history') return <HistoryWorkspace repoId={id} />;
    if (activePanel === 'branches')
      return <BranchesView repoId={id} onRefresh={() => void handleRefresh(true)} />;
    if (activePanel === 'stashes')
      return <StashesView repoId={id} onRefresh={() => void handleRefresh(true)} />;
    return <RemotesView repoId={id} />;
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
            onSelect={selectPanel}
            onSync={(operation, options) => void runSync(operation, options)}
            onRefresh={() => void handleRefresh()}
            onBranchSwitched={() => void handleRefresh(true)}
          />,
          repositoryToolbarSlot,
        )}
      <div
        className={
          'workspace-body' +
          (!hasInspector ? ' workspace-body--single' : '') +
          (hasInspector && layout.changesCollapsed ? ' workspace-body--right-hidden' : '')
        }
      >
        <div className="workspace-center">
          {(statusFailed || !status) && (
            <div className="repository-status-notice" role="status">
              <RepositoryStatusIndicator id={id!} />
              {statusEntry?.error && <span>{statusEntry.error}</span>}
              {statusFailed && (
                <button type="button" className="text-button" onClick={() => void fetchStatus(id!)}>
                  重试状态
                </button>
              )}
            </div>
          )}
          {error && (
            <div className="workspace-error" role="alert">
              {error}
            </div>
          )}
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
