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
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  ignored: 'Ignored',
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
      message.success(action === 'stage' ? `${paths.length} file${paths.length > 1 ? 's' : ''} staged` : `${paths.length} file${paths.length > 1 ? 's' : ''} unstaged`);
    } catch (err: any) {
      message.error(err.message || 'Git operation failed');
    } finally {
      setLoading(false);
    }
  };

  const discardFile = async (path: string) => {
    setLoading(true);
    try {
      await gitApi.checkout(repoId, [path]);
      await fetchStatus(repoId);
      message.success(`Discarded changes in ${path}`);
    } catch (err: any) {
      message.error(err.message || 'Unable to discard this file');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      message.warning('Add a commit message first');
      return;
    }
    setLoading(true);
    try {
      await gitApi.commit(repoId, commitMessage.trim(), commitDescription.trim() || undefined);
      setCommitMessage('');
      setCommitDescription('');
      await fetchStatus(repoId);
      message.success('Commit created');
    } catch (err: any) {
      message.error(err.message || 'Commit failed');
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
      message.success(operation === 'push' ? 'Push completed' : 'Pull completed');
      await refreshStatus();
    } catch (err: any) {
      message.error(err.message || `${operation} failed`);
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
        {file.staged ? <Button type="text" size="small" icon={<MinusOutlined />} aria-label={`Unstage ${file.path}`} loading={loading} onClick={() => void runFileAction('unstage', [file.path])} /> : <Button type="text" size="small" icon={<PlusOutlined />} aria-label={`Stage ${file.path}`} loading={loading} onClick={() => void runFileAction('stage', [file.path])} />}
        {!file.staged && file.status !== 'untracked' && <Popconfirm title="Discard this file's changes?" description="This cannot be undone." onConfirm={() => void discardFile(file.path)}><Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`Discard ${file.path}`} loading={loading} /></Popconfirm>}
      </div>
    </div>
  );

  const renderGroup = (title: string, groupFiles: any[], staged: boolean) => groupFiles.length > 0 ? (
    <div className="change-group" key={title}>
      <div className="change-group__header">
        <div className="change-group__title">{staged ? <CheckOutlined /> : <FolderOpenOutlined />} {title} <span className="count-badge">{groupFiles.length}</span></div>
        <div className="change-group__actions">
          <Button type="text" size="small" disabled={loading} onClick={() => void runFileAction(staged ? 'unstage' : 'stage', groupFiles.map((file) => file.path))}>{staged ? 'Unstage all' : 'Stage all'}</Button>
        </div>
      </div>
      {groupFiles.map(renderFileRow)}
    </div>
  ) : null;

  return (
    <section className="workspace-panel">
      <PanelHeader title="Changes" count={files.length} description="Review, stage, and commit your working tree" icon={<FileAddOutlined />} extra={<><Button type="text" icon={<ReloadOutlined />} aria-label="Refresh changes" onClick={() => void refreshStatus()}>Refresh</Button><Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void handleSync('push')}>Push</Button><Button icon={<UndoOutlined />} loading={loading} onClick={() => void handleSync('pull')}>Pull</Button></>} />
      {files.length === 0 ? <EmptyState title="Working tree clean" description="There are no staged or unstaged changes in this repository." action={<Button icon={<ReloadOutlined />} onClick={() => void refreshStatus()}>Refresh status</Button>} /> : <div className="changes-content">
        {renderGroup('Staged changes', stagedFiles, true)}
        {renderGroup('Changes', unstagedFiles, false)}
        {stagedFiles.length > 0 && <div className="commit-box">
          <div className="commit-box__heading"><span>Commit staged changes</span><span>{stagedFiles.length} file{stagedFiles.length > 1 ? 's' : ''} ready</span></div>
          <Input placeholder="Summary · describe the change" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} onPressEnter={() => void handleCommit()} />
          <Input.TextArea placeholder="Description (optional)" value={commitDescription} onChange={(event) => setCommitDescription(event.target.value)} rows={3} />
          <div className="commit-box__footer"><span className="commit-box__hint">Commit only includes files in Staged changes.</span><Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={() => void handleCommit()}>Commit staged</Button></div>
        </div>}
      </div>}
      {diff && <div className="changes-diff-hint"><StatusBadge status="ready" label="Diff loaded in the detail panel" /></div>}
    </section>
  );
}
