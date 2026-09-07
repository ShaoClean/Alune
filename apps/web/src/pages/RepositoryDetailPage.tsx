import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, message } from 'antd';
import {
  ArrowLeftOutlined,
  BranchesOutlined,
  CloudDownloadOutlined,
  CloudOutlined,
  CodeOutlined,
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
import { ChangesView } from '../components/ChangesView';
import { DiffViewer } from '../components/DiffViewer';
import { HistoryView } from '../components/HistoryView';
import { RemotesView } from '../components/RemotesView';
import { StashesView } from '../components/StashesView';
import { ErrorState, LoadingState, StatusBadge, formatBranchName, formatRelativeDate, FileIcon, RefBadge } from '../components/ui';

type Panel = 'changes' | 'history' | 'branches' | 'stashes' | 'remotes';
type SelectedFile = { path: string; status: string; staged: boolean };

const navItems: { key: Panel; label: string; icon: React.ReactNode }[] = [
  { key: 'changes', label: '改动', icon: <FileSearchOutlined /> },
  { key: 'history', label: '提交历史', icon: <HistoryOutlined /> },
  { key: 'branches', label: '分支', icon: <BranchesOutlined /> },
  { key: 'stashes', label: '储藏', icon: <InboxOutlined /> },
  { key: 'remotes', label: '远程', icon: <LinkOutlined /> },
];

export function RepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentRepo, openRepositories, status, branches, stashes, diff, diffLoading, diffError, setCurrentRepo, resetWorkspace, fetchStatus, fetchLog, fetchBranches, fetchStashes, fetchRemotes, fetchDiff, error } = useRepositoryStore();
  const [activePanel, setActivePanel] = useState<Panel>('changes');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<any | null>(null);
  const [syncing, setSyncing] = useState<'fetch' | 'pull' | 'push' | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setSelectedFile(null);
    setSelectedCommit(null);
    resetWorkspace();
    void Promise.all([repositoryApi.get(id), fetchStatus(id), fetchLog(id), fetchBranches(id), fetchRemotes(id)])
      .then(([repo]) => {
        if (!cancelled) setCurrentRepo(repo);
      })
      .catch((err: any) => {
        if (!cancelled) setPageError(err.message || '仓库不可用');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, fetchBranches, fetchLog, fetchRemotes, fetchStatus, resetWorkspace, setCurrentRepo]);

  const repository = currentRepo?.id === id ? currentRepo : openRepositories.find((repo: any) => repo.id === id) || null;
  const switchingRepository = currentRepo?.id !== id;
  const changeCount = status?.files?.length || 0;
  const activeLabel = navItems.find((item) => item.key === activePanel)?.label || '改动';

  const handleRefresh = async () => {
    if (!id) return;
    await fetchStatus(id);
    if (activePanel === 'history') await fetchLog(id);
    if (activePanel === 'branches') await fetchBranches(id);
    if (activePanel === 'stashes') await fetchStashes(id);
    if (activePanel === 'remotes') await fetchRemotes(id);
  };

  const runSync = async (operation: 'fetch' | 'pull' | 'push') => {
    if (!id) return;
    setSyncing(operation);
    try {
      await gitApi[operation](id);
      message.success(operation === 'fetch' ? '获取完成' : operation === 'pull' ? '拉取完成' : '推送完成');
      await handleRefresh();
    } catch (err: any) {
      message.error(err.message || `${operation === 'fetch' ? '获取' : operation === 'pull' ? '拉取' : '推送'}失败`);
    } finally {
      setSyncing(null);
    }
  };

  const handleSelectFile = (file: any) => {
    setSelectedFile({ path: file.path, status: file.status, staged: file.staged });
    setSelectedCommit(null);
  };

  const handleSelectCommit = (commit: any) => {
    setSelectedCommit(commit);
    setSelectedFile(null);
    if (id) void fetchDiff(id, { commit: commit.hash });
  };

  const detailTitle = useMemo(() => selectedFile?.path || selectedCommit?.shortHash || '检查器', [selectedCommit, selectedFile]);

  if (loading || switchingRepository) return <LoadingState label="正在打开仓库工作区…" />;
  if (pageError || (!repository && error)) return <ErrorState title="仓库不可用" description={pageError || error} onRetry={() => window.location.reload()} />;
  if (!repository) return <ErrorState title="未找到仓库" description="此仓库可能已被移除，或当前无法访问。" onRetry={() => navigate('/repositories')} />;

  const renderPanel = () => {
    if (!id) return null;
    if (activePanel === 'changes') return <ChangesView repoId={id} onRefresh={handleRefresh} onSelectFile={handleSelectFile} selectedFile={selectedFile?.path} />;
    if (activePanel === 'history') return <HistoryView repoId={id} onSelectCommit={handleSelectCommit} selectedHash={selectedCommit?.hash} />;
    if (activePanel === 'branches') return <BranchesView repoId={id} onRefresh={handleRefresh} />;
    if (activePanel === 'stashes') return <StashesView repoId={id} onRefresh={handleRefresh} />;
    return <RemotesView repoId={id} />;
  };

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div className="workspace-header__main">
          <div className="workspace-header__identity">
            <div className="repo-mark"><CodeOutlined /></div>
            <div>
              <h2>{repository.name}</h2>
              <div className="workspace-header__path" title={repository.path}>{repository.path}</div>
            </div>
          </div>
          <div className="workspace-header__actions">
            <Button icon={<CloudDownloadOutlined />} loading={syncing === 'fetch'} onClick={() => void runSync('fetch')}>获取</Button>
            <Button icon={<CloudOutlined />} loading={syncing === 'pull'} onClick={() => void runSync('pull')}>拉取</Button>
            <Button type="primary" icon={<SendOutlined />} loading={syncing === 'push'} onClick={() => void runSync('push')}>推送</Button>
            <Button icon={<ReloadOutlined />} aria-label="刷新仓库" loading={syncing !== null} onClick={() => void handleRefresh()}>刷新</Button>
          </div>
        </div>
        <div className="workspace-header__stats">
          <span className="workspace-stat"><BranchesOutlined /> <strong>{status?.branch ? formatBranchName(status.branch) : '游离 HEAD'}</strong></span>
          <StatusBadge status={changeCount > 0 ? 'dirty' : 'clean'} label={changeCount > 0 ? `${changeCount} 个文件有改动` : '工作区干净'} />
          <span className="workspace-stat workspace-stat--ahead">↑ <strong>{status?.ahead || 0}</strong> 领先</span>
          <span className="workspace-stat workspace-stat--behind">↓ <strong>{status?.behind || 0}</strong> 落后</span>
          <span className="workspace-stat"><ReloadOutlined /> 已刷新 {formatRelativeDate(new Date())}</span>
        </div>
      </div>

      <div className="workspace-body">
        <nav className="workspace-nav" aria-label="仓库面板">
          <div className="workspace-nav__label">仓库</div>
          <button type="button" className="workspace-nav__item" onClick={() => navigate('/repositories')}><ArrowLeftOutlined /> 返回仓库列表</button>
          {navItems.map((item) => <button key={item.key} type="button" className={`workspace-nav__item${activePanel === item.key ? ' workspace-nav__item--active' : ''}`} onClick={() => { setActivePanel(item.key); setSelectedFile(null); setSelectedCommit(null); }} aria-current={activePanel === item.key ? 'page' : undefined}>{item.icon}<span>{item.label}</span>{item.key === 'changes' && changeCount > 0 && <span className="count-badge">{changeCount}</span>}{item.key === 'branches' && branches.length > 0 && <span className="count-badge">{branches.length}</span>}{item.key === 'stashes' && stashes.length > 0 && <span className="count-badge">{stashes.length}</span>}</button>)}
        </nav>
        <div className="workspace-main-panel">
          <div className="workspace-panel-label">{activeLabel}</div>
          {renderPanel()}
        </div>
        <aside className="workspace-panel workspace-panel--detail" aria-label="仓库详情">
          {selectedCommit ? <div className="workspace-detail">
            <div className="workspace-detail__header"><div><h3>提交详情</h3><p>{selectedCommit.shortHash}</p></div><Button type="text" icon={<FileSearchOutlined />} aria-label="关闭提交详情" onClick={() => setSelectedCommit(null)} /></div>
            <div className="workspace-detail__body">
              <div className="detail-avatar">{selectedCommit.author?.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div className="detail-meta"><div className="detail-meta__item"><span className="detail-meta__label">提交信息</span><span className="detail-meta__value">{selectedCommit.message}</span></div><div className="detail-meta__item"><span className="detail-meta__label">作者</span><span className="detail-meta__value">{selectedCommit.author} · {selectedCommit.email}</span></div><div className="detail-meta__item"><span className="detail-meta__label">提交时间</span><span className="detail-meta__value">{selectedCommit.date ? new Date(selectedCommit.date).toLocaleString('zh-CN') : '—'}</span></div><div className="detail-meta__item"><span className="detail-meta__label">提交</span><span className="detail-meta__value detail-meta__value--mono">{selectedCommit.hash}</span></div></div>
              <div className="commit-file-list"><div className="branch-section__title">引用</div>{(selectedCommit.refs || []).length > 0 ? selectedCommit.refs.map((ref: string) => <RefBadge key={ref} value={ref} />) : <span className="detail-meta__value">暂无引用</span>}</div>
            </div>
            <div className="detail-diff"><DiffViewer diff={diff} loading={diffLoading} error={diffError} title={`提交 ${selectedCommit.shortHash}`} /></div>
          </div> : selectedFile ? <DiffViewer diff={diff} loading={diffLoading} error={diffError} title={detailTitle} onClose={() => setSelectedFile(null)} /> : <div className="workspace-detail workspace-detail--empty"><div className="detail-empty-icon"><FileIcon path="preview.ts" /></div><h3>检查器</h3><p>选择“改动”中的文件或“提交历史”中的提交，以查看差异和元数据。</p></div>}
        </aside>
      </div>
    </div>
  );
}
