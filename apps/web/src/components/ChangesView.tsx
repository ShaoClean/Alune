import { AmendCommitDialog } from './AmendCommitDialog';
import { useWorkspaceFileMenu } from './WorkspaceFileMenu';
import type { ShowHistory } from './WorkspaceFileMenu';
import { FeedbackNotice } from '@alune/ui';
import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Tooltip, type TooltipProps } from '@alune/ui';
import { AlunePopconfirm } from '@alune/ui';
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
import { EmptyState, ErrorState, FileIcon, FolderIcon, LoadingState, PanelHeader } from '@alune/ui';
import { EMPTY_DRAFT, useCommitDraftStore } from '../stores/commitDraftStore';
import { DeleteNewFileDialog } from './DeleteNewFileDialog';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { AluneModal, CheckCard, useAluneConfirm } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import type { DialogIconName } from '@alune/ui';
import { DialogCard, DialogNote, DialogPath, DialogStat, DialogStats } from '@alune/ui';
import { Sparkles } from './Sparkles';
import { useCommitGeneration } from '../hooks/useCommitGeneration';
import { ConflictOperationBar } from './ConflictOperationBar';
import { useMarkResolved } from './ConflictResolver';
import { conflictKindLabels } from './conflict-model';

interface Props {
  repoId: string;
  onRefresh: () => Promise<void>;
  onSelectFile?: (file: any) => void;
  selectedFile?: { path: string; staged: boolean } | null;
  onFileChanged?: (path: string) => void;
  onShowHistory?: ShowHistory;
  managedRebase?: boolean;
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

const kindIcon = (file: FileStatus): DialogIconName =>
  file.kind === 'worktree'
    ? 'tree'
    : file.kind === 'repository'
      ? 'folder-open'
      : file.kind === 'submodule'
        ? 'link'
        : 'folder';

/** Mirrors the rule ignoreDirectory() appends to info/exclude. */
const excludeRule = (path: string) =>
  '/' + path.replace(/\/$/, '').replace(/[\\*?\[\]#! ]/g, '\\$&') + '/';

const GENERATION_SCOPE = '仅分析已暂存改动 · 由你确认后提交';

// Pair foreground and background explicitly; dark-theme primary text is not a tooltip color.
const FILE_ACTION_TOOLTIP: Pick<TooltipProps, 'trigger' | 'color' | 'styles'> = {
  trigger: ['hover', 'focus'],
  color: 'var(--text)',
  styles: { container: { color: 'var(--surface)' } },
};

// Reordering the form must not change when committing is allowed.
export const commitDisabled = (busy: boolean, stagedCount: number, message: string) =>
  busy || !stagedCount || !message.trim();

export function ChangesView({
  repoId,
  onRefresh,
  onSelectFile,
  selectedFile,
  onFileChanged,
  onShowHistory,
  managedRebase = false,
}: Props) {
  const message = useFeedbackMessage();
  const confirm = useAluneConfirm();
  const navigate = useNavigate();
  const origin = useRef<string | null>(repoId);
  useEffect(() => {
    origin.current = repoId;
    return () => {
      origin.current = null;
    };
  }, [repoId]);
  const { entry, stale } = useRepositoryStatus(repoId);
  const { status, fetchStatus, repositories } = useRepositoryStore();
  const repoName = repositories.find((repo) => repo.id === repoId)?.name;
  const draft = useCommitDraftStore((state) => state.drafts[repoId] || EMPTY_DRAFT);
  const { updateDraft, clearSubmittedDraft } = useCommitDraftStore();
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [discardOpenPath, setDiscardOpenPath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const discardAllTrigger = useRef<HTMLButtonElement>(null);
  const [directoryFile, setDirectoryFile] = useState<FileStatus | null>(null);
  const [stagePlan, setStagePlan] = useState<{
    actionable: FileStatus[];
    skipped: FileStatus[];
  } | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const busy = loading || operationBusy || deletePath !== null || discardAllOpen;

  const panel = useRef<HTMLElement>(null);
  const actionFocus = useRef<{
    element: HTMLElement;
    nextLabel: string;
    scrollTop: number;
  } | null>(null);
  useLayoutEffect(() => {
    const saved = actionFocus.current;
    if (loading || !saved || !panel.current) return;
    actionFocus.current = null;
    // Do not steal focus if the user moved elsewhere while Git was running.
    if (document.activeElement !== document.body && document.activeElement !== saved.element)
      return;
    const buttons = Array.from(panel.current.querySelectorAll<HTMLButtonElement>('button'));
    const target = saved.element.isConnected
      ? saved.element
      : buttons.find((button) => button.getAttribute('aria-label') === saved.nextLabel) ||
        panel.current.querySelector<HTMLInputElement>('input[aria-label="筛选改动文件"]');
    target?.focus({ preventScroll: true });
    const content = panel.current.querySelector('.changes-content');
    if (content) content.scrollTop = saved.scrollTop;
  }, [loading]);
  const fileMenu = useWorkspaceFileMenu(
    repoId,
    (path) => onFileChanged?.(path),
    busy,
    onShowHistory,
  );

  const files = status?.files || [];
  const stagedFiles = useMemo(() => files.filter((file: any) => file.staged), [files]);
  const stagedSignature = JSON.stringify(
    stagedFiles.map((file) => [file.path, file.status, file.oldPath]),
  );
  const ai = useCommitGeneration(repoId, stagedSignature, stagedFiles.length);
  const modelLabel = ai.model ? ai.model.model.name : '尚未配置 AI';
  const unstagedFiles = useMemo(
    () => files.filter((file) => !file.staged && !file.conflicted),
    [files],
  );
  const conflictFiles = useMemo(() => files.filter((file) => file.conflicted), [files]);
  const operation = status?.operation;
  const addedPaths = useMemo(
    () => new Set(files.filter((file) => file.status === 'added').map((file) => file.path)),
    [files],
  );

  const refreshStatus = async () => {
    await onRefresh();
  };
  const markResolved = useMarkResolved(repoId, refreshStatus);

  const runFileAction = async (action: 'stage' | 'unstage', paths: string[]) => {
    if (busy) return;
    ai.cancel('暂存内容正在变化，请在操作完成后重新生成。');
    const element = document.activeElement;
    if (element instanceof HTMLElement && panel.current?.contains(element)) {
      const label = element.getAttribute('aria-label');
      actionFocus.current = {
        element,
        nextLabel:
          paths.length === 1 && label === `${action === 'stage' ? '暂存' : '取消暂存'} ${paths[0]}`
            ? `${action === 'stage' ? '取消暂存' : '暂存'} ${paths[0]}`
            : action === 'stage'
              ? '全部取消暂存'
              : '全部暂存',
        scrollTop: panel.current.querySelector('.changes-content')?.scrollTop || 0,
      };
    }
    setLoading(true);
    try {
      await gitApi[action](repoId, paths);
      await fetchStatus(repoId, true);
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
    if (!skipped.length) {
      void runFileAction(
        action,
        actionable.map((file) => file.path),
      );
      return;
    }
    setStagePlan({ actionable, skipped });
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
      setStagePlan(null);
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
    void confirm({
      level: 1,
      glyph: 'eye-off',
      eyebrow: { label: '改动', detail: [repoName, '未跟踪目录'].filter(Boolean).join(' · ') },
      title: '在本地忽略此目录？',
      description: '目录及其内容会从当前仓库的未跟踪列表中隐藏，磁盘文件会保留。',
      content: (
        <>
          <DialogCard>
            <div className="dlg-diff">
              <div className="dlg-diff-file">
                <DialogIcon name="file" />
                <DialogPath path=".git/info/exclude" />
                <span className="adds">+1</span>
              </div>
              <div className="dlg-diff-row is-add">
                <span className="ln" />
                <span className="sg">+</span>
                <code>{excludeRule(file.path)}</code>
              </div>
            </div>
          </DialogCard>
          <DialogNote quiet>
            写入 Git 本地忽略文件，对同一仓库的 Worktree 生效，不会修改团队的 .gitignore。
          </DialogNote>
        </>
      ),
      hintVerb: '忽略',
      okIcon: 'eye-off',
      busyText: '正在写入…',
      okText: '本地忽略',
      onOk: async () => {
        setLoading(true);
        try {
          await gitApi.ignoreDirectory(repoId, file.path);
          if (origin.current !== repoId) return;
          setDirectoryFile(null);
          await fetchStatus(repoId, true);
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
      await Promise.all([
        fetchStatus(repoId, true),
        useRepositoryStore.getState().fetchLog(repoId),
      ]);
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
        {...fileMenu.bindings(file.path, !kind)}
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
              file.conflicted ? '冲突：解决后标记为已解决' : statusWords[file.status] || file.status
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
          {file.conflict && (
            <span className="file-row__conflict">{conflictKindLabels[file.conflict]}</span>
          )}
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
          {file.conflicted && !kind ? (
            <Tooltip title={busy ? null : '标记为已解决'} {...FILE_ACTION_TOOLTIP}>
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                aria-label={`标记为已解决 ${file.path}`}
                disabled={busy}
                onClick={() => void markResolved(file.path)}
              />
            </Tooltip>
          ) : file.staged ? (
            <Tooltip title={busy ? null : '取消暂存'} {...FILE_ACTION_TOOLTIP}>
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                aria-label={`取消暂存 ${file.path}`}
                loading={loading}
                disabled={busy}
                onClick={() => void runFileAction('unstage', [file.path])}
              />
            </Tooltip>
          ) : actions.stage ? (
            <Tooltip title={busy ? null : '暂存文件'} {...FILE_ACTION_TOOLTIP}>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                aria-label={`暂存 ${file.path}`}
                loading={loading}
                disabled={busy}
                onClick={() => void runFileAction('stage', [file.path])}
              />
            </Tooltip>
          ) : null}
          {actions.open && (
            <Tooltip
              title={busy ? null : file.kind === 'worktree' ? '打开 Worktree' : '打开仓库'}
              {...FILE_ACTION_TOOLTIP}
            >
              <Button
                type="text"
                size="small"
                icon={<ExportOutlined />}
                aria-label={`打开${file.kind === 'worktree' ? ' Worktree' : '仓库'} ${file.path}`}
                disabled={busy}
                onClick={() => void openChangeRepository(file)}
              />
            </Tooltip>
          )}
          {actions.ignore && (
            <Tooltip title={busy ? null : '本地忽略此目录'} {...FILE_ACTION_TOOLTIP}>
              <Button
                type="text"
                size="small"
                icon={<EyeInvisibleOutlined />}
                aria-label={`本地忽略 ${file.path}`}
                disabled={busy}
                onClick={() => ignoreChangeDirectory(file)}
              />
            </Tooltip>
          )}
          {actions.discard && (
            <AlunePopconfirm
              title="丢弃此文件的未暂存改动？"
              description="恢复为暂存区的内容，已暂存的改动保留。此操作不可撤销。"
              icon="undo"
              tone="danger"
              wide
              focus="extra"
              extra={
                <>
                  <p className="a-pop-path">
                    <DialogPath path={file.path} />
                    {file.additions ? (
                      <span className="dlg-badge is-mono" data-tone="success">
                        +{file.additions}
                      </span>
                    ) : null}
                    {file.deletions ? (
                      <span className="dlg-badge is-mono" data-tone="danger">
                        −{file.deletions}
                      </span>
                    ) : null}
                  </p>
                  <CheckCard
                    plain
                    tone="danger"
                    checked={discardConfirmed}
                    onChange={setDiscardConfirmed}
                    title="我确认丢弃未暂存改动"
                  />
                </>
              }
              onOpenChange={(open) => {
                setDiscardConfirmed(false);
                setDiscardOpenPath(open ? file.path : null);
              }}
              okDisabled={!discardConfirmed}
              okText="丢弃改动"
              disabled={busy}
              onConfirm={() => discardFile(file.path)}
            >
              <Tooltip
                title={busy || discardOpenPath === file.path ? null : '丢弃未暂存改动'}
                {...FILE_ACTION_TOOLTIP}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<UndoOutlined />}
                  aria-label={`丢弃 ${file.path}`}
                  loading={loading}
                  disabled={busy}
                />
              </Tooltip>
            </AlunePopconfirm>
          )}
          {!kind && (actions.delete || addedPaths.has(file.path)) && (
            <Tooltip title={busy ? null : '删除整个新增文件'} {...FILE_ACTION_TOOLTIP}>
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                aria-label={`删除整个新增文件 ${file.path}（${file.staged ? '已暂存' : '未暂存'}）`}
                disabled={busy}
                onClick={() => {
                  ai.cancel();
                  setDeletePath(file.path);
                }}
              />
            </Tooltip>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (title: string, groupFiles: any[], staged: boolean, conflicts = false) =>
    groupFiles.length > 0 ? (
      <div className={`change-group${conflicts ? ' change-group--conflict' : ''}`} key={title}>
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
          {conflicts ? (
            <span className="change-group__hint">选择文件逐块解决</span>
          ) : (
            <div className="change-group__actions">
              {!staged && (
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<UndoOutlined />}
                  aria-label="放弃所有更改"
                  ref={discardAllTrigger}
                  disabled={busy}
                  onClick={() => setDiscardAllOpen(true)}
                >
                  放弃所有更改
                </Button>
              )}
              <Button
                type="text"
                size="small"
                aria-label={staged ? '全部取消暂存' : '全部暂存'}
                disabled={
                  busy ||
                  !groupFiles.some((file) => changeActions(file)[staged ? 'unstage' : 'stage'])
                }
                onClick={() => runGroupAction(groupFiles, staged)}
              >
                {staged ? '全部取消暂存' : '全部暂存'}
              </Button>
            </div>
          )}
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
    <section ref={panel} className="workspace-panel changes-panel">
      {directoryFile && (
        <AluneModal
          open
          glyph={kindIcon(directoryFile)}
          eyebrow={{ label: '改动', detail: [repoName, '未跟踪'].filter(Boolean).join(' · ') }}
          title={`${changeKindLabel(directoryFile)}详情`}
          onCancel={() => setDirectoryFile(null)}
          hints={
            <p className="a-dlg-hints">
              <span>
                <kbd className="dlg-kbd">Esc</kbd> 关闭
              </span>
            </p>
          }
          footer={
            <>
              <Button type="text" onClick={() => setDirectoryFile(null)}>
                关闭
              </Button>
              {changeActions(directoryFile).ignore && (
                <Button disabled={loading} onClick={() => ignoreChangeDirectory(directoryFile)}>
                  本地忽略
                </Button>
              )}
              {changeActions(directoryFile).open && (
                <Button
                  type="primary"
                  className="has-orb"
                  loading={loading}
                  onClick={() => void openChangeRepository(directoryFile)}
                >
                  <span>{directoryFile.kind === 'worktree' ? '打开 Worktree' : '打开仓库'}</span>
                  <span className="dlg-orb" aria-hidden="true">
                    <DialogIcon name="arrow-up-right" />
                  </span>
                </Button>
              )}
            </>
          }
        >
          <DialogCard>
            <div className="dlg-card-row">
              <span className="dlg-repo-tile" aria-hidden="true">
                <DialogIcon name="folder" />
              </span>
              <div className="dlg-repo-meta">
                <strong>{directoryFile.path.replace(/\/$/, '')}</strong>
                <DialogPath path={directoryFile.repositoryPath || directoryFile.path} />
              </div>
            </div>
          </DialogCard>
          <p className="dlg-text">
            {directoryFile.kind === 'directory' || !directoryFile.kind
              ? '此路径是目录，无法作为单个文件预览、暂存或删除。请在文件树中查看内容并单独处理。'
              : '此目录有独立的 Git 状态。请打开对应仓库查看改动；当前仓库的批量操作会跳过此目录。'}
          </p>
          {directoryFile.kind === 'worktree' && (
            <DialogNote quiet>需要移除此工作目录时，请使用 Worktree 管理中的移除操作。</DialogNote>
          )}
        </AluneModal>
      )}
      {stagePlan && (
        <AluneModal
          open
          level={1}
          glyph="plus"
          eyebrow={{
            label: '改动',
            detail: [repoName, status?.branch].filter(Boolean).join(' · '),
          }}
          title={`暂存 ${stagePlan.actionable.length} 项改动？`}
          description={`将跳过以下 ${stagePlan.skipped.length} 项，请在对应仓库中处理。`}
          hintVerb="暂存"
          okText="暂存可处理的改动"
          busyText="正在暂存…"
          onCancel={() => setStagePlan(null)}
          onOk={async () => {
            const paths = stagePlan.actionable.map((file) => file.path);
            await runFileAction('stage', paths);
            setStagePlan(null);
          }}
        >
          <DialogCard>
            <DialogStats>
              <DialogStat tone="info" value={stagePlan.actionable.length} label="将暂存" />
              <DialogStat off value={stagePlan.skipped.length} label="跳过" />
            </DialogStats>
          </DialogCard>
          <DialogCard>
            <div className="dlg-list is-scroll">
              {stagePlan.skipped.map((file) => (
                <div className="dlg-list-item" key={file.path}>
                  <DialogIcon name={kindIcon(file)} />
                  <div className="dlg-list-main">
                    <strong>{file.path.replace(/\/$/, '')}</strong>
                    <span className="dlg-path">
                      {changeKindLabel(file) || '文件'} ·{' '}
                      {file.kind ? '有独立的 Git 状态' : '无法在此暂存'}
                    </span>
                  </div>
                  {changeActions(file).open && (
                    <Button
                      size="small"
                      disabled={loading}
                      onClick={() => void openChangeRepository(file)}
                    >
                      打开仓库
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </DialogCard>
        </AluneModal>
      )}
      {discardAllOpen && (
        <DiscardChangesDialog
          key={repoId}
          repoId={repoId}
          onClose={() => {
            setDiscardAllOpen(false);
            requestAnimationFrame(() => discardAllTrigger.current?.focus({ preventScroll: true }));
          }}
        />
      )}
      {fileMenu.element}
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
        {status && !managedRebase && (
          <ConflictOperationBar
            repoId={repoId}
            repoName={repoName}
            operation={operation}
            conflicts={conflictFiles.length}
            disabled={busy && !operationBusy}
            onBusyChange={setOperationBusy}
            onChanged={refreshStatus}
          />
        )}
        {!status ? (
          entry?.phase === 'error' ? (
            <ErrorState
              announce={false}
              title="无法读取仓库状态"
              description={entry.error}
              onRetry={() => void refreshStatus()}
            />
          ) : (
            <LoadingState label="正在读取仓库状态…" />
          )
        ) : files.length === 0 ? (
          operation ? null : (
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
          )
        ) : (
          <>
            {renderGroup('冲突', conflictFiles, false, true)}
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
      {amendOpen && (
        <AmendCommitDialog
          key={repoId}
          repoId={repoId}
          onClose={() => setAmendOpen(false)}
          onCommitted={onRefresh}
        />
      )}
      <div className="commit-box">
        <div className="commit-box__heading">
          <strong>提交改动</strong>
          <Button
            type="text"
            size="small"
            disabled={busy || !!operation}
            onClick={() => setAmendOpen(true)}
          >
            修改上一次提交
          </Button>
          <span>
            {operation ? '进行中的操作请用上方的“继续”完成' : `${stagedFiles.length} 个文件已暂存`}
          </span>
        </div>
        <Input
          aria-label="提交摘要"
          placeholder="摘要 · 描述这次改动"
          value={draft.message}
          readOnly={busy}
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
          readOnly={busy}
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
        <FeedbackNotice
          source="commit-generation-progress"
          type="info"
          title={ai.generating ? '正在根据已暂存改动生成…' : null}
          actionLabel="取消"
          onAction={() => ai.cancel()}
        />
        <FeedbackNotice
          source="commit-generation-result"
          type={ai.feedback?.error ? 'error' : 'info'}
          title={ai.feedback?.message}
          eventKey={ai.feedback ?? undefined}
          actionLabel={ai.feedback?.error ? '重试' : undefined}
          onAction={() => ai.generate()}
          busy={busy}
        />
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
          disabled={!!operation || commitDisabled(busy, stagedFiles.length, draft.message)}
          onClick={() => void handleCommit()}
        >
          提交已暂存内容{stagedFiles.length > 0 ? ` · ${stagedFiles.length}` : ''}
        </Button>
      </div>
    </section>
  );
}
