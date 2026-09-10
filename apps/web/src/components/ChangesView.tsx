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
  SearchOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';
import { EmptyState, FileIcon, PanelHeader } from './ui';
import { EMPTY_DRAFT, useCommitDraftStore } from '../stores/commitDraftStore';

interface Props {
  repoId: string;
  onRefresh: () => Promise<void>;
  onSelectFile?: (file: any) => void;
  selectedFile?: { path: string; staged: boolean } | null;
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
  const { status, fetchStatus } = useRepositoryStore();
  const draft = useCommitDraftStore((state) => state.drafts[repoId] || EMPTY_DRAFT);
  const { updateDraft, clearSubmittedDraft } = useCommitDraftStore();
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const files = status?.files || [];
  const stagedFiles = useMemo(() => files.filter((file: any) => file.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((file: any) => !file.staged), [files]);

  const refreshStatus = async () => {
    await onRefresh();
  };

  const runFileAction = async (action: 'stage' | 'unstage', paths: string[]) => {
    setLoading(true);
    try {
      await gitApi[action](repoId, paths);
      await fetchStatus(repoId);
      message.success(
        action === 'stage' ? `${paths.length} 个文件已暂存` : `${paths.length} 个文件已取消暂存`,
      );
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
    if (loading || stagedFiles.length === 0) return;
    if (!draft.message.trim()) {
      message.warning('请先填写提交信息');
      return;
    }
    setLoading(true);
    try {
      await gitApi.commit(repoId, draft.message.trim(), draft.description.trim() || undefined);
      clearSubmittedDraft(repoId, draft);
      await fetchStatus(repoId);
      message.success('提交已创建');
    } catch (err: any) {
      message.error(err.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const renderFileRow = (file: any) => (
    <div
      className={`file-row${selectedFile?.path === file.path && selectedFile?.staged === file.staged ? ' file-row--selected' : ''}`}
      key={`${file.staged}-${file.path}`}
    >
      <button
        type="button"
        className="file-row__select"
        aria-label={`查看差异 ${file.path}（${file.staged ? '已暂存' : '未暂存'}）`}
        aria-pressed={selectedFile?.path === file.path && selectedFile?.staged === file.staged}
        onClick={() => onSelectFile?.(file)}
      >
        <span
          className={`file-row__status file-row__status--${file.status}`}
          title={statusWords[file.status] || file.status}
        >
          {statusLabels[file.status] || '?'}
        </span>
        <FileIcon path={file.path} status={file.status} />
        <span
          className="file-row__path"
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        >
          <strong>
            {file.oldPath ? `${file.oldPath.split('/').pop()} → ` : ''}
            {file.path.split('/').pop()}
          </strong>
          <small>
            {file.path.includes('/')
              ? file.path.slice(0, file.path.lastIndexOf('/'))
              : '仓库根目录'}
          </small>
        </span>
        <span className="file-row__stats">
          {file.additions ? <span className="additions">+{file.additions}</span> : null}
          {file.deletions ? <span className="deletions">−{file.deletions}</span> : null}
        </span>
      </button>
      <div className="file-row__actions">
        {file.staged ? (
          <Button
            type="text"
            size="small"
            icon={<MinusOutlined />}
            aria-label={`取消暂存 ${file.path}`}
            loading={loading}
            onClick={() => void runFileAction('unstage', [file.path])}
          />
        ) : (
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label={`暂存 ${file.path}`}
            loading={loading}
            onClick={() => void runFileAction('stage', [file.path])}
          />
        )}
        {!file.staged && file.status !== 'untracked' && (
          <Popconfirm
            title="丢弃此文件的改动？"
            description="此操作不可撤销。"
            onConfirm={() => void discardFile(file.path)}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              aria-label={`丢弃 ${file.path}`}
              loading={loading}
            />
          </Popconfirm>
        )}
      </div>
    </div>
  );

  const renderGroup = (title: string, groupFiles: any[], staged: boolean) =>
    groupFiles.length > 0 ? (
      <div className="change-group" key={title}>
        <div className="change-group__header">
          <button
            type="button"
            className="change-group__title"
            aria-expanded={!closedGroups[title]}
            onClick={() => setClosedGroups((groups) => ({ ...groups, [title]: !groups[title] }))}
          >
            {closedGroups[title] ? <RightOutlined /> : <DownOutlined />}
            {staged ? <CheckOutlined /> : <FolderOpenOutlined />} {title}{' '}
            <span className="count-badge">{groupFiles.length}</span>
          </button>
          <div className="change-group__actions">
            <Button
              type="text"
              size="small"
              disabled={loading}
              onClick={() =>
                void runFileAction(
                  staged ? 'unstage' : 'stage',
                  groupFiles.map((file) => file.path),
                )
              }
            >
              {staged ? '全部取消暂存' : '全部暂存'}
            </Button>
          </div>
        </div>
        {!closedGroups[title] &&
          groupFiles
            .filter((file) =>
              `${file.path} ${file.oldPath || ''}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map(renderFileRow)}
      </div>
    ) : null;

  return (
    <section className="workspace-panel changes-panel">
      <PanelHeader title="改动" count={files.length} icon={<FileAddOutlined />} />
      <div className="changes-filter">
        <Input
          aria-label="筛选改动文件"
          placeholder="筛选文件…"
          prefix={<SearchOutlined />}
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="changes-content">
        {files.length === 0 ? (
          <EmptyState
            title="工作区干净"
            description="此仓库没有已暂存或未暂存的改动。"
            action={
              <Button icon={<ReloadOutlined />} onClick={() => void refreshStatus()}>
                刷新状态
              </Button>
            }
          />
        ) : (
          <>
            {renderGroup('未暂存', unstagedFiles, false)}
            {renderGroup('已暂存', stagedFiles, true)}
            {query &&
              !files.some((file: any) =>
                `${file.path} ${file.oldPath || ''}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
              ) && <p className="changes-no-results">没有匹配的文件</p>}
          </>
        )}
      </div>
      <div className="commit-box">
        <div className="commit-box__heading">
          <strong>提交改动</strong>
          <span>{stagedFiles.length} 个文件已暂存</span>
        </div>
        <Input
          aria-label="提交摘要"
          placeholder="摘要 · 描述这次改动"
          value={draft.message}
          disabled={loading}
          onChange={(event) => updateDraft(repoId, { message: event.target.value })}
        />
        <Input.TextArea
          aria-label="提交描述"
          placeholder="描述（可选）"
          value={draft.description}
          disabled={loading}
          onChange={(event) => updateDraft(repoId, { description: event.target.value })}
          rows={2}
        />
        <Button
          type="primary"
          block
          icon={<CheckOutlined />}
          loading={loading}
          disabled={!stagedFiles.length || !draft.message.trim()}
          onClick={() => void handleCommit()}
        >
          提交已暂存内容{stagedFiles.length > 0 ? ` · ${stagedFiles.length}` : ''}
        </Button>
        <div className="commit-box__hint">提交仅包含已暂存的文件</div>
      </div>
    </section>
  );
}
