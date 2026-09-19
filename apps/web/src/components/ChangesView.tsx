import { useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Tooltip, message } from 'antd';
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
  UndoOutlined,
  LoadingOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useRepositoryStatus } from '../hooks/useRepositoryStatus';
import { gitApi } from '../api';
import { EmptyState, ErrorState, FileIcon, LoadingState, PanelHeader } from './ui';
import { EMPTY_DRAFT, useCommitDraftStore } from '../stores/commitDraftStore';
import { DeleteNewFileDialog } from './DeleteNewFileDialog';
import { Sparkles } from './Sparkles';
import { useCommitGeneration } from '../hooks/useCommitGeneration';

interface Props {
  repoId: string;
  onRefresh: () => Promise<void>;
  onSelectFile?: (file: any) => void;
  selectedFile?: { path: string; staged: boolean } | null;
  onFileChanged?: (path: string) => void;
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

export function ChangesView({
  repoId,
  onRefresh,
  onSelectFile,
  selectedFile,
  onFileChanged,
}: Props) {
  const { entry, stale } = useRepositoryStatus(repoId);
  const { status, fetchStatus } = useRepositoryStore();
  const draft = useCommitDraftStore((state) => state.drafts[repoId] || EMPTY_DRAFT);
  const { updateDraft, clearSubmittedDraft } = useCommitDraftStore();
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const busy = loading || deletePath !== null;

  const files = status?.files || [];
  const stagedFiles = useMemo(() => files.filter((file: any) => file.staged), [files]);
  const stagedSignature = JSON.stringify(
    stagedFiles.map((file) => [file.path, file.status, file.oldPath]),
  );
  const ai = useCommitGeneration(repoId, stagedSignature, stagedFiles.length);
  const unstagedFiles = useMemo(() => files.filter((file: any) => !file.staged), [files]);
  const addedPaths = useMemo(
    () => new Set(files.filter((file) => file.status === 'added').map((file) => file.path)),
    [files],
  );

  const refreshStatus = async () => {
    await onRefresh();
  };

  const runFileAction = async (action: 'stage' | 'unstage', paths: string[]) => {
    if (busy) return;
    ai.cancel('暂存内容正在变化，请在操作完成后重新生成。');
    setLoading(true);
    try {
      await gitApi[action](repoId, paths);
      await fetchStatus(repoId, true);
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
    if (busy) return;
    setLoading(true);
    try {
      await gitApi.checkout(repoId, [path]);
      await fetchStatus(repoId, true);
      message.success(`已丢弃 ${path} 的改动`);
    } catch (err: any) {
      message.error(err.message || '无法丢弃此文件的改动');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (busy || stagedFiles.length === 0) return;
    if (!draft.message.trim()) {
      message.warning('请先填写提交信息');
      return;
    }
    ai.cancel();
    setLoading(true);
    try {
      await gitApi.commit(repoId, draft.message.trim(), draft.description.trim() || undefined);
      clearSubmittedDraft(repoId, draft);
      await fetchStatus(repoId, true);
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
            disabled={busy}
            onClick={() => void runFileAction('unstage', [file.path])}
          />
        ) : (
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label={`暂存 ${file.path}`}
            loading={loading}
            disabled={busy}
            onClick={() => void runFileAction('stage', [file.path])}
          />
        )}
        {!file.staged && file.status !== 'untracked' && file.status !== 'added' && (
          <Popconfirm
            title="丢弃此文件的未暂存改动？"
            description={
              addedPaths.has(file.path)
                ? '将恢复为暂存区的内容，保留已暂存的新增文件。此操作不可撤销。'
                : '此操作不可撤销。'
            }
            disabled={busy}
            onConfirm={() => discardFile(file.path)}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<UndoOutlined />}
              aria-label={`丢弃 ${file.path}`}
              title="丢弃未暂存改动"
              loading={loading}
              disabled={busy}
            />
          </Popconfirm>
        )}
        {(file.status === 'untracked' || addedPaths.has(file.path)) && (
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            aria-label={`删除整个新增文件 ${file.path}（${file.staged ? '已暂存' : '未暂存'}）`}
            title="删除整个新增文件"
            disabled={busy}
            onClick={() => {
              ai.cancel();
              setDeletePath(file.path);
            }}
          />
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
              disabled={busy}
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
      {deletePath !== null && (
        <DeleteNewFileDialog
          key={`${repoId}-${deletePath}`}
          repoId={repoId}
          path={deletePath}
          onClose={() => setDeletePath(null)}
          onFileChanged={onFileChanged}
        />
      )}
      <PanelHeader
        title="改动"
        icon={<FileAddOutlined />}
      />
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
        {!status ? (
          entry?.phase === 'error' ? (
            <ErrorState
              title="无法读取仓库状态"
              description={entry.error}
              onRetry={() => void refreshStatus()}
            />
          ) : (
            <LoadingState label="正在读取仓库状态…" />
          )
        ) : files.length === 0 ? (
          <EmptyState
            title={stale ? '上次读取时工作区干净' : '工作区干净'}
            description={
              stale ? '当前状态尚未确认，请刷新后查看。' : '此仓库没有已暂存或未暂存的改动。'
            }
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
          disabled={busy}
          onChange={(event) => updateDraft(repoId, { message: event.target.value })}
          suffix={
            <Tooltip title="AI 生成提交信息">
              <button
                type="button"
                className="commit-ai-button"
                aria-label="AI 生成提交信息"
                disabled={busy || ai.generating}
                onClick={() => void ai.generate()}
              >
                {ai.generating ? <LoadingOutlined spin /> : <Sparkles />}
              </button>
            </Tooltip>
          }
        />
        <Input.TextArea
          aria-label="提交描述"
          placeholder="描述（可选）"
          value={draft.description}
          disabled={busy}
          onChange={(event) => updateDraft(repoId, { description: event.target.value })}
          rows={2}
        />
        <Button
          type="primary"
          block
          icon={<CheckOutlined />}
          loading={loading}
          disabled={busy || !stagedFiles.length || !draft.message.trim()}
          onClick={() => void handleCommit()}
        >
          提交已暂存内容{stagedFiles.length > 0 ? ` · ${stagedFiles.length}` : ''}
        </Button>
        <div className="commit-ai-meta">
          <span
            title={
              ai.model ? `${ai.model.provider.name} · ${ai.model.model.id}` : '尚未配置默认模型'
            }
          >
            {ai.model ? ai.model.model.name : '尚未配置 AI'}
          </span>
          <button type="button" onClick={() => ai.openSettings()} aria-label="提交生成设置">
            <SettingOutlined /> 提交生成
          </button>
        </div>
        {ai.generating ? (
          <div className="commit-ai-feedback" role="status">
            <span>正在根据已暂存改动生成…</span>
            <button type="button" onClick={() => ai.cancel()}>
              取消
            </button>
          </div>
        ) : (
          ai.feedback && (
            <div
              className={`commit-ai-feedback${ai.feedback.error ? ' commit-ai-feedback--error' : ''}`}
              role={ai.feedback.error ? 'alert' : 'status'}
            >
              <span>{ai.feedback.message}</span>
              {ai.feedback.error && (
                <button type="button" disabled={busy} onClick={() => void ai.generate()}>
                  重试
                </button>
              )}
            </div>
          )
        )}
        {ai.undo && !ai.generating && (
          <button type="button" className="commit-ai-undo" onClick={ai.undoGeneration}>
            <UndoOutlined /> 撤销生成
          </button>
        )}
        <div className="commit-box__hint">仅分析已暂存改动 · 由你确认后提交</div>
      </div>
    </section>
  );
}
