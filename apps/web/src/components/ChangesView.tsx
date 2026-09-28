import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Popconfirm, Tooltip, App } from 'antd';
import { useNavigate } from 'react-router-dom';
import { changeActions, changeKindLabel, type FileStatus } from '@alune/shared';
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
  EyeInvisibleOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useRepositoryStatus } from '../hooks/useRepositoryStatus';
import { gitApi } from '../api';
import { EmptyState, ErrorState, FileIcon, FolderIcon, LoadingState, PanelHeader } from './ui';
import { EMPTY_DRAFT, useCommitDraftStore } from '../stores/commitDraftStore';
import { DeleteNewFileDialog } from './DeleteNewFileDialog';
import { DiscardChangesDialog } from './DiscardChangesDialog';
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

const GENERATION_SCOPE = '仅分析已暂存改动 · 由你确认后提交';

// Reordering the form must not change when committing is allowed.
export const commitDisabled = (busy: boolean, stagedCount: number, message: string) =>
  busy || !stagedCount || !message.trim();

export function ChangesView({
  repoId,
  onRefresh,
  onSelectFile,
  selectedFile,
  onFileChanged,
}: Props) {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const origin = useRef<string | null>(repoId);
  useEffect(() => {
    origin.current = repoId;
    return () => {
      origin.current = null;
    };
  }, [repoId]);
  const { entry, stale } = useRepositoryStatus(repoId);
  const { status, fetchStatus } = useRepositoryStore();
  const draft = useCommitDraftStore((state) => state.drafts[repoId] || EMPTY_DRAFT);
  const { updateDraft, clearSubmittedDraft } = useCommitDraftStore();
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [directoryFile, setDirectoryFile] = useState<FileStatus | null>(null);
  const busy = loading || deletePath !== null || discardAllOpen;

  const files = status?.files || [];
  const stagedFiles = useMemo(() => files.filter((file: any) => file.staged), [files]);
  const stagedSignature = JSON.stringify(
    stagedFiles.map((file) => [file.path, file.status, file.oldPath]),
  );
  const ai = useCommitGeneration(repoId, stagedSignature, stagedFiles.length);
  const modelLabel = ai.model ? ai.model.model.name : '尚未配置 AI';
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
        action === 'stage' ? `${paths.length} 项改动已暂存` : `${paths.length} 项改动已取消暂存`,
      );
    } catch (err: any) {
      message.error(err.message || 'Git 操作失败');
    } finally {
      setLoading(false);
    }
  };

  const runGroupAction = (groupFiles: FileStatus[], staged: boolean) => {
    const action = staged ? 'unstage' : 'stage';
    const actionable = groupFiles.filter((file) => changeActions(file)[action]);
    const skipped = groupFiles.filter((file) => !changeActions(file)[action]);
    if (!actionable.length) return;
    const run = () =>
      runFileAction(
        action,
        actionable.map((file) => file.path),
      );
    if (!skipped.length) {
      void run();
      return;
    }
    modal.confirm({
      title: `暂存 ${actionable.length} 项改动？`,
      content: (
        <>
          <p>将跳过以下 {skipped.length} 项，请在对应仓库中处理：</p>
          <ul>
            {skipped.map((file) => (
              <li className="git-path-detail" key={file.path}>
                {file.path}
              </li>
            ))}
          </ul>
        </>
      ),
      okText: '暂存可处理的改动',
      cancelText: '取消',
      onOk: run,
    });
  };

  const openChangeRepository = async (file: FileStatus) => {
    if (loading || !file.repositoryPath) return;
    const store = useRepositoryStore.getState();
    const parent = store.repositories.find((repo) => repo.id === repoId) || store.currentRepo;
    if (!parent || parent.id !== repoId) return;
    const registered = store.repositories.find(
      (repo) =>
        repo.source === parent.source &&
        repo.connectionId === parent.connectionId &&
        repo.path === file.repositoryPath,
    );
    setLoading(true);
    try {
      const repo =
        file.kind === 'worktree'
          ? await store.addWorktree(repoId, file.repositoryPath)
          : registered ||
            (parent.source === 'local'
              ? await store.addLocalRepository(file.repositoryPath)
              : await store.addRepository(parent.connectionId, file.repositoryPath));
      if (origin.current !== repoId) return;
      setDirectoryFile(null);
      store.openRepository(repo);
      navigate('/repositories/' + repo.id);
    } catch (error: any) {
      message.error(error.message || '无法打开仓库，请刷新状态后重试');
    } finally {
      if (origin.current === repoId) setLoading(false);
    }
  };

  const ignoreChangeDirectory = (file: FileStatus) => {
    if (loading) return;
    modal.confirm({
      title: '在本地忽略此目录？',
      content: (
        <>
          <p className="git-path-detail">{file.path}</p>
          <p>
            目录及其内容会从当前仓库的未跟踪列表中隐藏，磁盘文件会保留。规则写入 Git
            本地忽略文件，对同一仓库的 Worktree 生效，不会修改团队的 .gitignore。
          </p>
        </>
      ),
      okText: '本地忽略',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          await gitApi.ignoreDirectory(repoId, file.path);
          if (origin.current !== repoId) return;
          setDirectoryFile(null);
          await fetchStatus(repoId, true);
          message.success('已添加本地忽略规则');
        } catch (error: any) {
          message.error(error.message || '无法忽略此目录');
        } finally {
          if (origin.current === repoId) setLoading(false);
        }
      },
    });
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

  const renderFileRow = (file: FileStatus) => {
    const actions = changeActions(file);
    const kind = changeKindLabel(file);
    const displayPath = file.path.replace(/\/$/, '');
    return (
      <div
        className={`file-row${selectedFile?.path === file.path && selectedFile?.staged === file.staged ? ' file-row--selected' : ''}`}
        key={`${file.staged}-${file.path}`}
      >
        <button
          type="button"
          className="file-row__select"
          aria-label={`${actions.diff ? '查看差异' : `查看${kind}`} ${file.path}（${file.staged ? '已暂存' : '未暂存'}）`}
          aria-pressed={selectedFile?.path === file.path && selectedFile?.staged === file.staged}
          onClick={() => (actions.diff ? onSelectFile?.(file) : setDirectoryFile(file))}
        >
          <span
            className={`file-row__status file-row__status--${file.status}`}
            title={
              file.conflicted
                ? '合并冲突：解决文件内容后暂存'
                : statusWords[file.status] || file.status
            }
          >
            {file.conflicted ? 'U' : statusLabels[file.status] || '?'}
          </span>
          {kind ? (
            <FolderIcon variant={file.kind === 'directory' ? 'folder' : 'repository'} />
          ) : (
            <FileIcon path={file.path} />
          )}
          <span
            className="file-row__path"
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          >
            <strong>
              {file.oldPath ? `${file.oldPath.split('/').pop()} → ` : ''}
              {displayPath.split('/').pop()}
            </strong>
            {displayPath.includes('/') && (
              <small>{displayPath.slice(0, displayPath.lastIndexOf('/'))}</small>
            )}
          </span>
          {kind && (
            <span
              className="file-row__kind"
              title={
                file.kind === 'submodule'
                  ? [
                      file.submodule?.commitChanged && '提交指针变化',
                      file.submodule?.trackedChanges && '内部文件已修改',
                      file.submodule?.untrackedChanges && '包含未跟踪文件',
                    ]
                      .filter(Boolean)
                      .join('；') || kind
                  : kind
              }
            >
              {kind}
            </span>
          )}
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
          ) : actions.stage ? (
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              aria-label={`暂存 ${file.path}`}
              loading={loading}
              disabled={busy}
              onClick={() => void runFileAction('stage', [file.path])}
            />
          ) : null}
          {actions.open && (
            <Button
              type="text"
              size="small"
              icon={<ExportOutlined />}
              aria-label={`打开${file.kind === 'worktree' ? ' Worktree' : '仓库'} ${file.path}`}
              title={file.kind === 'worktree' ? '打开 Worktree' : '打开仓库'}
              disabled={busy}
              onClick={() => void openChangeRepository(file)}
            />
          )}
          {actions.ignore && (
            <Button
              type="text"
              size="small"
              icon={<EyeInvisibleOutlined />}
              aria-label={`本地忽略 ${file.path}`}
              title="本地忽略此目录"
              disabled={busy}
              onClick={() => ignoreChangeDirectory(file)}
            />
          )}
          {actions.discard && (
            <Popconfirm
              title="丢弃此文件的未暂存改动？"
              description={
                <div>
                  <p className="git-path-detail">{file.path}</p>
                  <p>将恢复为暂存区的内容，保留已暂存改动。此操作不可撤销。</p>
                  <Checkbox
                    checked={discardConfirmed}
                    onChange={(event) => setDiscardConfirmed(event.target.checked)}
                  >
                    我确认丢弃未暂存改动
                  </Checkbox>
                </div>
              }
              onOpenChange={() => setDiscardConfirmed(false)}
              okButtonProps={{ disabled: !discardConfirmed, danger: true }}
              okText="丢弃改动"
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
          {!kind && (actions.delete || addedPaths.has(file.path)) && (
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
  };

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
            {!staged && (
              <Button
                type="text"
                size="small"
                danger
                icon={<UndoOutlined />}
                aria-label="放弃所有更改"
                disabled={busy}
                onClick={() => setDiscardAllOpen(true)}
              >
                放弃所有更改
              </Button>
            )}
            <Button
              type="text"
              size="small"
              disabled={
                busy ||
                !groupFiles.some((file) => changeActions(file)[staged ? 'unstage' : 'stage'])
              }
              onClick={() => runGroupAction(groupFiles, staged)}
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
      {directoryFile && (
        <Modal
          open
          title={`${changeKindLabel(directoryFile)}详情`}
          onCancel={() => setDirectoryFile(null)}
          footer={
            <>
              <Button onClick={() => setDirectoryFile(null)}>关闭</Button>
              {changeActions(directoryFile).ignore && (
                <Button disabled={loading} onClick={() => ignoreChangeDirectory(directoryFile)}>
                  本地忽略
                </Button>
              )}
              {changeActions(directoryFile).open && (
                <Button
                  type="primary"
                  loading={loading}
                  onClick={() => void openChangeRepository(directoryFile)}
                >
                  {directoryFile.kind === 'worktree' ? '打开 Worktree' : '打开仓库'}
                </Button>
              )}
            </>
          }
        >
          <p className="git-path-detail">{directoryFile.path}</p>
          <p>
            {directoryFile.kind === 'directory'
              ? '此路径是目录，无法作为单个文件预览、暂存或删除。请在文件树中查看内容并单独处理。'
              : '此目录有独立的 Git 状态。请打开对应仓库查看改动；当前仓库的批量操作会跳过此目录。'}
          </p>
          {directoryFile.kind === 'worktree' && (
            <p>需要移除此工作目录时，请使用 Worktree 管理中的移除操作。</p>
          )}
        </Modal>
      )}
      {discardAllOpen && (
        <DiscardChangesDialog
          key={repoId}
          repoId={repoId}
          onClose={() => setDiscardAllOpen(false)}
        />
      )}
      {deletePath !== null && (
        <DeleteNewFileDialog
          key={`${repoId}-${deletePath}`}
          repoId={repoId}
          path={deletePath}
          onClose={() => setDeletePath(null)}
          onFileChanged={onFileChanged}
        />
      )}
      <PanelHeader title="改动" icon={<FileAddOutlined />} />
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
            <Tooltip title={ai.generating ? '正在生成提交信息' : '生成提交信息'}>
              <button
                type="button"
                className="commit-ai-generate"
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
        <div className="commit-ai-bar">
          <Tooltip
            title={
              ai.model ? `${ai.model.provider.name} · ${ai.model.model.id}` : '尚未配置默认模型'
            }
          >
            <button
              type="button"
              className="commit-ai-bar__model"
              aria-label={`AI 模型 ${modelLabel}，打开提交生成设置`}
              onClick={() => ai.openSettings()}
            >
              <SettingOutlined />
              <span>{modelLabel}</span>
            </button>
          </Tooltip>
          <span className="commit-ai-bar__hint">{GENERATION_SCOPE}</span>
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
        <Button
          type="primary"
          block
          icon={<CheckOutlined />}
          loading={loading}
          disabled={commitDisabled(busy, stagedFiles.length, draft.message)}
          onClick={() => void handleCommit()}
        >
          提交已暂存内容{stagedFiles.length > 0 ? ` · ${stagedFiles.length}` : ''}
        </Button>
      </div>
    </section>
  );
}
