import { useMemo, useState } from 'react';
import { Button, Input, Popconfirm, message } from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';
import { EmptyState, FileIcon, PanelHeader, StatusBadge } from './ui';

interface Props {
  repoId: string;
  onRefresh: () => void;
  onSelectFile?: (file: any) => void;
  selectedFile?: string | null;
}

const statusLabels: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  ignored: 'I',
};

const statusWords: Record<string, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  copied: '复制',
  untracked: '未跟踪',
  ignored: '已忽略',
};

export function ChangesView({ repoId, onRefresh, onSelectFile, selectedFile }: Props) {
  const { status, diff, fetchStatus, fetchDiff } = useRepositoryStore();
  const [commitMessage, setCommitMessage] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const files = status?.files || [];
  const stagedFiles = useMemo(() => files.filter((file: any) => file.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((file: any) => !file.staged), [files]);

  const refreshStatus = async () => {
    await fetchStatus(repoId);
    onRefresh();
  };

  const runFileAction = async (action: 'stage' | 'unstage', paths: string[]) => {
    setLoading(true);
    try {
      await gitApi[action](repoId, paths);
      await fetchStatus(repoId);
      message.success(action === 'stage' ? `${paths.length} 个文件已暂存` : `${paths.length} 个文件已取消暂存`);
    } catch (err: any) {
      message.error(err.message || 'Git 操作失败');
    } finally {
      setLoading(false);
    }
  };

  const discardFile = async (path: string) => {
    setLoading(true);
    try {
      await gitApi.checkout(repoId, [path]);
      await fetchStatus(repoId);
      message.success(`已丢弃 ${path} 的改动`);
    } catch (err: any) {
      message.error(err.message || '无法丢弃此文件的改动');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      message.warning('请先填写提交信息');
      return;
    }
    setLoading(true);
    try {
      await gitApi.commit(repoId, commitMessage.trim(), commitDescription.trim() || undefined);
      setCommitMessage('');
      setCommitDescription('');
      await fetchStatus(repoId);
      message.success('提交已创建');
    } catch (err: any) {
      message.error(err.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDiff = async (file: any) => {
    onSelectFile?.(file);
    try {
      await fetchDiff(repoId, { file: file.path, staged: file.staged });
    } catch {
      // The store exposes the error state; keep the selected file visible.
    }
  };

  const handleSync = async (operation: 'push' | 'pull') => {
    setLoading(true);
    try {
      await gitApi[operation](repoId);
      message.success(operation === 'push' ? '推送完成' : '拉取完成');
      await refreshStatus();
    } catch (err: any) {
      message.error(err.message || `${operation === 'push' ? '推送' : '拉取'}失败`);
    } finally {
      setLoading(false);
    }
  };

  const renderFileRow = (file: any) => (
    <div className={`file-row${selectedFile === file.path ? ' file-row--selected' : ''}`} key={`${file.staged}-${file.path}`} onClick={() => void handleDiff(file)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') void handleDiff(file); }}>
      <span className={`file-row__status file-row__status--${file.status}`} title={statusWords[file.status] || file.status}>{statusLabels[file.status] || '?'}</span>
      <FileIcon path={file.path} status={file.status} />
      <span className="file-row__path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
      <span className="file-row__stats">{file.additions ? <span className="additions">+{file.additions}</span> : null}{file.deletions ? <span className="deletions">−{file.deletions}</span> : null}</span>
      <div className="file-row__actions" onClick={(event) => event.stopPropagation()}>
        {file.staged ? <Button type="text" size="small" icon={<MinusOutlined />} aria-label={`取消暂存 ${file.path}`} loading={loading} onClick={() => void runFileAction('unstage', [file.path])} /> : <Button type="text" size="small" icon={<PlusOutlined />} aria-label={`暂存 ${file.path}`} loading={loading} onClick={() => void runFileAction('stage', [file.path])} />}
        {!file.staged && file.status !== 'untracked' && <Popconfirm title="丢弃此文件的改动？" description="此操作不可撤销。" onConfirm={() => void discardFile(file.path)}><Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`丢弃 ${file.path}`} loading={loading} /></Popconfirm>}
      </div>
    </div>
  );

  const renderGroup = (title: string, groupFiles: any[], staged: boolean) => groupFiles.length > 0 ? (
    <div className="change-group" key={title}>
      <div className="change-group__header">
        <div className="change-group__title">{staged ? <CheckOutlined /> : <FolderOpenOutlined />} {title} <span className="count-badge">{groupFiles.length}</span></div>
        <div className="change-group__actions">
          <Button type="text" size="small" disabled={loading} onClick={() => void runFileAction(staged ? 'unstage' : 'stage', groupFiles.map((file) => file.path))}>{staged ? '全部取消暂存' : '全部暂存'}</Button>
        </div>
      </div>
      {groupFiles.map(renderFileRow)}
    </div>
  ) : null;

  return (
    <section className="workspace-panel">
      <PanelHeader title="改动" count={files.length} description="查看、暂存并提交工作区改动" icon={<FileAddOutlined />} extra={<><Button type="text" icon={<ReloadOutlined />} aria-label="刷新改动" onClick={() => void refreshStatus()}>刷新</Button><Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void handleSync('push')}>推送</Button><Button icon={<UndoOutlined />} loading={loading} onClick={() => void handleSync('pull')}>拉取</Button></>} />
      {files.length === 0 ? <EmptyState title="工作区干净" description="此仓库没有已暂存或未暂存的改动。" action={<Button icon={<ReloadOutlined />} onClick={() => void refreshStatus()}>刷新状态</Button>} /> : <div className="changes-content">
        {renderGroup('已暂存的改动', stagedFiles, true)}
        {renderGroup('改动', unstagedFiles, false)}
        {stagedFiles.length > 0 && <div className="commit-box">
          <div className="commit-box__heading"><span>提交已暂存的改动</span><span>{stagedFiles.length} 个文件已就绪</span></div>
          <Input placeholder="摘要 · 描述这次改动" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onPressEnter={() => void handleCommit()} />
          <Input.TextArea placeholder="描述（可选）" value={commitDescription} onChange={(event) => setCommitDescription(event.target.value)} rows={3} />
          <div className="commit-box__footer"><span className="commit-box__hint">提交只会包含“已暂存的改动”中的文件。</span><Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={() => void handleCommit()}>提交已暂存内容</Button></div>
        </div>}
      </div>}
      {diff && <div className="changes-diff-hint"><StatusBadge status="ready" label="差异已加载到详情面板" /></div>}
    </section>
  );
}
