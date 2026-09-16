import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Button, Dropdown, message } from 'antd';
import type { CommitFile } from '@remote-git/shared';
import {
  ArrowLeftOutlined,
  BranchesOutlined,
  CloudDownloadOutlined,
  CloudOutlined,
  DownOutlined,
  MoreOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  InboxOutlined,
  LinkOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { BranchesView } from '../components/BranchesView';
import { RepositoryStatusIndicator } from '../components/RepositoryStatusIndicator';
import { useRepositoryStatus } from '../hooks/useRepositoryStatus';
import { ChangesView } from '../components/ChangesView';
import { DiffViewer } from '../components/DiffViewer';
import { HistoryView } from '../components/HistoryView';
import { RemotesView } from '../components/RemotesView';
import { StashesView } from '../components/StashesView';
import { ErrorState, LoadingState, formatBranchName, FileIcon, RefBadge } from '../components/ui';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { CHANGES_MIN } from '../stores/workspaceLayout';
import { PanelResizeHandle } from '../components/PanelResizeHandle';

type Panel = 'changes' | 'history' | 'branches' | 'stashes' | 'remotes';
type SelectedFile = { path: string; status: string; staged: boolean };

const commitStatusLabels: Record<CommitFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
};

const commitStatusWords: Record<CommitFile['status'], string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  copied: '复制',
};

const navItems: { key: Panel; label: string; icon: React.ReactNode }[] = [
  { key: 'changes', label: '改动', icon: <FileSearchOutlined /> },
  { key: 'history', label: '提交历史', icon: <HistoryOutlined /> },
  { key: 'branches', label: '分支', icon: <BranchesOutlined /> },
  { key: 'stashes', label: '储藏', icon: <InboxOutlined /> },
  { key: 'remotes', label: '远程', icon: <LinkOutlined /> },
];

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <RepositoryWorkspace key={id} id={id} />;
}

function RepositoryWorkspace({ id }: { id: string | undefined }) {
  const navigate = useNavigate();
  const { setRightPanelAvailable } = useOutletContext<{
    setRightPanelAvailable: (available: boolean) => void;
  }>();
  const { layout, compact, changesWidth, changesMax, updateLayout } = useWorkspaceLayout();
  const backButton = useRef<HTMLButtonElement>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const {
    currentRepo,
    openRepositories,
    status,
    branches,
    stashes,
    commitFiles,
    commitFilesLoading,
    commitFilesError,
    diff,
    diffLoading,
    diffError,
    setCurrentRepo,
    resetWorkspace,
    fetchStatus,
    fetchLog,
    fetchBranches,
    fetchStashes,
    fetchRemotes,
    fetchCommitFiles,
    fetchDiff,
    clearDiff,
    error,
  } = useRepositoryStore();
  const { entry: statusEntry, stale: statusStale } = useRepositoryStatus(id || '');
  const [activePanel, setActivePanel] = useState<Panel>('changes');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<any | null>(null);
  const [syncing, setSyncing] = useState<'fetch' | 'pull' | 'push' | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setSelectedFile(null);
    setSelectedCommitFile(null);
    setSelectedCommit(null);
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
  const changeCount = new Set(status?.files.map((file) => file.path)).size;
  const activeLabel = navItems.find((item) => item.key === activePanel)?.label || '改动';
  const hasInspector = activePanel === 'changes' || activePanel === 'history';
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

  useLayoutEffect(() => {
    if (id && selectedCommit) {
      void fetchDiff(id, { commit: selectedCommit.hash, file: selectedCommitFile?.path });
    } else if (
      id &&
      selectedFile &&
      status?.files.some(
        (file: SelectedFile) =>
          file.path === selectedFile.path && file.staged === selectedFile.staged,
      )
    ) {
      void fetchDiff(id, { file: selectedFile.path, staged: selectedFile.staged });
    } else clearDiff();
    return clearDiff;
  }, [
    id,
    selectedFile?.path,
    selectedFile?.staged,
    selectedCommit?.hash,
    selectedCommitFile?.path,
    status,
    fetchDiff,
    clearDiff,
  ]);

  const selectPanel = (panel: Panel) => {
    setActivePanel(panel);
    setSelectedFile(null);
    setSelectedCommitFile(null);
    setSelectedCommit(null);
    if (compact) updateLayout({ changesCollapsed: false });
  };

  const handleRefresh = async (afterMutation = false) => {
    if (!id) return;
    await fetchStatus(id, afterMutation);
    if (activePanel === 'history') await fetchLog(id);
    if (activePanel === 'branches') await fetchBranches(id);
    if (activePanel === 'stashes') await fetchStashes(id);
    if (activePanel === 'remotes') await fetchRemotes(id);
  };

  const runSync = async (operation: 'fetch' | 'pull' | 'push') => {
    if (!id || syncing) return;
    setSyncing(operation);
    try {
      await gitApi[operation](id);
      message.success(
        operation === 'fetch' ? '获取完成' : operation === 'pull' ? '拉取完成' : '推送完成',
      );
      await handleRefresh(true);
    } catch (err: any) {
      message.error(
        err.message ||
          `${operation === 'fetch' ? '获取' : operation === 'pull' ? '拉取' : '推送'}失败`,
      );
    } finally {
      setSyncing(null);
    }
  };

  const handleSelectFile = (file: any) => {
    returnTarget.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (compact) updateLayout({ changesCollapsed: true });
    setSelectedFile({ path: file.path, status: file.status, staged: file.staged });
    setSelectedCommitFile(null);
    setSelectedCommit(null);
  };

  const handleSelectCommit = (commit: any) => {
    returnTarget.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (compact) updateLayout({ changesCollapsed: true });
    setSelectedCommit(commit);
    setSelectedFile(null);
    setSelectedCommitFile(null);
    if (id) void fetchCommitFiles(id, commit.hash);
  };

  const handleSelectCommitFile = (file: CommitFile) => {
    setSelectedCommitFile(file);
  };

  const handleSelectAllCommitFiles = () => {
    setSelectedCommitFile(null);
  };

  const renderCommitFileRow = (file: CommitFile) => {
    const displayPath = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    return (
      <button
        type="button"
        className={`commit-file-row${selectedCommitFile?.path === file.path ? ' commit-file-row--selected' : ''}`}
        key={`${file.status}-${file.oldPath || ''}-${file.path}`}
        onClick={() => handleSelectCommitFile(file)}
        title={`查看 ${displayPath} 的差异`}
      >
        <span
          className={`commit-file-row__status commit-file-row__status--${file.status}`}
          title={commitStatusWords[file.status]}
        >
          {commitStatusLabels[file.status]}
        </span>
        <FileIcon path={file.path} status={file.status} />
        <span className="commit-file-row__path">{displayPath}</span>
        <span className="commit-file-row__stats">
          {file.additions ? <span className="additions">+{file.additions}</span> : null}
          {file.deletions ? <span className="deletions">−{file.deletions}</span> : null}
        </span>
      </button>
    );
  };

  const detailTitle = useMemo(
    () => selectedFile?.path || selectedCommit?.shortHash || '检查器',
    [selectedCommit, selectedFile],
  );

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
    if (activePanel === 'history')
      return (
        <HistoryView
          repoId={id}
          onSelectCommit={handleSelectCommit}
          selectedHash={selectedCommit?.hash}
        />
      );
    if (activePanel === 'branches')
      return <BranchesView repoId={id} onRefresh={() => void handleRefresh(true)} />;
    if (activePanel === 'stashes')
      return <StashesView repoId={id} onRefresh={() => void handleRefresh(true)} />;
    return <RemotesView repoId={id} />;
  };

  return (
    <div
      className={`workspace-page${compact ? ' workspace-page--compact' : ''}${compact && layout.changesCollapsed ? ' workspace-page--inspecting' : ''}`}
      style={{ '--changes-width': `${changesWidth}px` } as CSSProperties}
    >
      <div
        className={
          'workspace-body' +
          (!hasInspector ? ' workspace-body--single' : '') +
          (layout.changesCollapsed ? ' workspace-body--right-hidden' : '')
        }
      >
        <div className="workspace-center">
          <nav className="workspace-panel-tabs" aria-label="仓库面板">
            {navItems.slice(0, 3).map((item) => (
              <button
                key={item.key}
                type="button"
                className={activePanel === item.key ? 'workspace-panel-tab--active' : ''}
                onClick={() => selectPanel(item.key)}
                aria-current={activePanel === item.key ? 'page' : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.key === 'changes' && changeCount > 0 && (
                  <span className="count-badge">{changeCount}</span>
                )}
                {item.key === 'branches' && branches.length > 0 && (
                  <span className="count-badge">{branches.length}</span>
                )}
              </button>
            ))}
            <Dropdown
              trigger={['click']}
              menu={{
                selectedKeys: [activePanel],
                items: [
                  {
                    key: 'stashes',
                    label: `储藏${stashes.length ? ` · ${stashes.length}` : ''}`,
                    icon: <InboxOutlined />,
                    onClick: () => selectPanel('stashes'),
                  },
                  {
                    key: 'remotes',
                    label: '远程',
                    icon: <LinkOutlined />,
                    onClick: () => selectPanel('remotes'),
                  },
                  { type: 'divider' },
                  {
                    key: 'repositories',
                    label: '返回仓库列表',
                    icon: <ArrowLeftOutlined />,
                    onClick: () => navigate('/repositories'),
                  },
                ],
              }}
            >
              <button
                type="button"
                className={
                  activePanel === 'stashes' || activePanel === 'remotes'
                    ? 'workspace-panel-tab--active'
                    : ''
                }
                aria-label="更多仓库视图"
              >
                <MoreOutlined />
                <span>
                  {activePanel === 'stashes' || activePanel === 'remotes' ? activeLabel : '更多'}
                </span>
              </button>
            </Dropdown>
            <div className="workspace-header__actions">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                aria-label="刷新仓库"
                title="刷新仓库"
                disabled={syncing !== null}
                onClick={() => void handleRefresh()}
              />
              <Button
                type="text"
                size="small"
                icon={<CloudDownloadOutlined />}
                aria-label="获取"
                title="获取远程更新"
                disabled={syncing !== null}
                loading={syncing === 'fetch'}
                onClick={() => void runSync('fetch')}
              >
                <span className="workspace-action-label">获取</span>
              </Button>
              <Button
                type="text"
                size="small"
                icon={<CloudOutlined />}
                aria-label="拉取"
                title={status ? `拉取 · 落后 ${status.behind} 个提交` : '拉取 · 状态未知'}
                disabled={syncing !== null}
                loading={syncing === 'pull'}
                onClick={() => void runSync('pull')}
              >
                拉取
                {status && status.behind > 0 && (
                  <span className="count-badge">{status.behind}</span>
                )}
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<SendOutlined />}
                aria-label="推送"
                title={status ? `推送 · 领先 ${status.ahead} 个提交` : '推送 · 状态未知'}
                disabled={syncing !== null}
                loading={syncing === 'push'}
                onClick={() => void runSync('push')}
              >
                推送
                {status && status.ahead > 0 && <span className="count-badge">{status.ahead}</span>}
              </Button>
            </div>
          </nav>
          <div className="workspace-header">
            <div
              className="workspace-header__identity"
              title={`${repository.name} · ${repository.path}`}
            >
              <button
                type="button"
                className="workspace-branch"
                title={status ? status.branch || '游离 HEAD' : '分支未知'}
                onClick={() => selectPanel('branches')}
              >
                <BranchesOutlined />
                <span>
                  {status
                    ? status.branch
                      ? formatBranchName(status.branch)
                      : '游离 HEAD'
                    : '分支未知'}
                </span>
                <DownOutlined />
              </button>
              <span className="workspace-diff-label">
                {activePanel === 'changes' ? '工作区中的更改' : activeLabel}
              </span>
            </div>
            <span className="workspace-sync-summary">
              {status
                ? changeCount + ' 个文件有改动 · ↑' + status.ahead + ' ↓' + status.behind
                : '正在读取状态'}
            </span>
          </div>
          {(statusEntry?.phase === 'error' || statusStale || !status) && (
            <div className="repository-status-notice" role="status">
              <RepositoryStatusIndicator id={id!} />
              {statusEntry?.error && <span>{statusEntry.error}</span>}
              {(statusEntry?.phase === 'error' || statusStale) && (
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
              {selectedCommit ? (
                <div className="workspace-detail">
                  <div className="workspace-detail__header">
                    <div>
                      <h3>提交详情</h3>
                      <p>{selectedCommit.shortHash}</p>
                    </div>
                    <Button
                      type="text"
                      icon={<FileSearchOutlined />}
                      aria-label="关闭提交详情"
                      onClick={() => {
                        setSelectedCommit(null);
                        setSelectedCommitFile(null);
                        returnToList();
                      }}
                    />
                  </div>
                  <div className="workspace-detail__body">
                    <div className="detail-avatar">
                      {selectedCommit.author
                        ?.split(/\s+/)
                        .map((part: string) => part[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="detail-meta">
                      <div className="detail-meta__item">
                        <span className="detail-meta__label">提交信息</span>
                        <span className="detail-meta__value">{selectedCommit.message}</span>
                      </div>
                      <div className="detail-meta__item">
                        <span className="detail-meta__label">作者</span>
                        <span className="detail-meta__value">
                          {selectedCommit.author} · {selectedCommit.email}
                        </span>
                      </div>
                      <div className="detail-meta__item">
                        <span className="detail-meta__label">提交时间</span>
                        <span className="detail-meta__value">
                          {selectedCommit.date
                            ? new Date(selectedCommit.date).toLocaleString('zh-CN')
                            : '—'}
                        </span>
                      </div>
                      <div className="detail-meta__item">
                        <span className="detail-meta__label">提交</span>
                        <span className="detail-meta__value detail-meta__value--mono">
                          {selectedCommit.hash}
                        </span>
                      </div>
                    </div>
                    <div className="commit-file-list">
                      <div className="commit-file-list__header">
                        <span>文件变更</span>
                        <span className="commit-file-list__header-actions">
                          {selectedCommitFile && (
                            <Button type="text" size="small" onClick={handleSelectAllCommitFiles}>
                              查看全部
                            </Button>
                          )}
                          {commitFilesLoading ? (
                            <span className="commit-file-list__loading">加载中…</span>
                          ) : (
                            <span className="count-badge">{commitFiles.length}</span>
                          )}
                        </span>
                      </div>
                      {commitFilesError ? (
                        <div className="commit-file-list__message commit-file-list__message--error">
                          无法加载文件列表：{commitFilesError}
                        </div>
                      ) : commitFilesLoading ? (
                        <div className="commit-file-list__message">正在读取此次提交涉及的文件…</div>
                      ) : commitFiles.length > 0 ? (
                        commitFiles.map(renderCommitFileRow)
                      ) : (
                        <div className="commit-file-list__message">
                          此次提交没有可显示的文件变更。
                        </div>
                      )}
                    </div>
                    <div className="commit-ref-list">
                      <div className="branch-section__title">引用</div>
                      {(selectedCommit.refs || []).length > 0 ? (
                        selectedCommit.refs.map((ref: string) => <RefBadge key={ref} value={ref} />)
                      ) : (
                        <span className="detail-meta__value">暂无引用</span>
                      )}
                    </div>
                  </div>
                  <div className="detail-diff">
                    <DiffViewer
                      onFocus={() =>
                        updateLayout({ sidebarCollapsed: true, changesCollapsed: true })
                      }
                      diff={diff}
                      loading={diffLoading}
                      error={diffError}
                      title={selectedCommitFile?.path || `提交 ${selectedCommit.shortHash}`}
                    />
                  </div>
                </div>
              ) : selectedFile ? (
                <DiffViewer
                  diff={diff}
                  loading={diffLoading}
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
