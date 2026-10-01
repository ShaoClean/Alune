import { FeedbackNotice } from '@alune/ui';
import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Button, Input } from '@alune/ui';
import { DeleteOutlined, PlusOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorktreeInfo } from '@alune/shared';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneModal } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogNote, DialogPath } from '@alune/ui';

const errorMessage = (error: any) => error.response?.data?.message || error.message || '读取失败';
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

// Shared by the toolbar popover and the narrow-screen dialog, so both routes list the
// same worktrees and open them the same way.
export function WorktreesPanel({
  repoId,
  active,
  onOpened,
  onDismiss,
  panelRef,
}: {
  repoId: string;
  active: boolean;
  onOpened: () => void;
  onDismiss: () => void;
  panelRef?: Ref<HTMLElement>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationKey = useRef(location.key);
  locationKey.current = location.key;
  const [items, setItems] = useState<WorktreeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const local = useRepositoryStore(
    (state) =>
      state.repositories.find((repo) => repo.id === repoId)?.source === 'local' ||
      (state.currentRepo?.id === repoId && state.currentRepo.source === 'local'),
  );
  const repoName = useRepositoryStore(
    (state) =>
      state.repositories.find((repo) => repo.id === repoId)?.name ??
      (state.currentRepo?.id === repoId ? state.currentRepo.name : undefined),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      controller.current?.abort();
    };
  }, [repoId]);

  const refresh = async () => {
    controller.current?.abort();
    const current = ++request.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      const result = await repositoryApi.worktrees(repoId, abort.signal);
      if (current === request.current) setItems(result);
    } catch (failure) {
      if (current === request.current) setError(errorMessage(failure));
    } finally {
      if (current === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, repoId]);

  const openWorktree = async (item: WorktreeInfo) => {
    if (opening) return;
    const origin = locationKey.current;
    setOpening(item.path);
    setError(null);
    try {
      const repo = await useRepositoryStore.getState().addWorktree(repoId, item.path);
      if (!mounted.current || origin !== locationKey.current) return;
      onOpened();
      useRepositoryStore.getState().openRepository(repo);
      navigate('/repositories/' + repo.id);
    } catch (failure) {
      if (mounted.current && origin === locationKey.current) setError(errorMessage(failure));
    } finally {
      if (mounted.current) setOpening(null);
    }
  };

  const create = async () => {
    const origin = locationKey.current;
    setMutationBusy(true);
    setMutationError('');
    try {
      const repo = await gitApi.createWorktree(repoId, newPath, newBranch.trim());
      useRepositoryStore.getState().registerRepository(repo);
      if (!mounted.current || origin !== locationKey.current) return;
      setCreateOpen(false);
      await refresh();
      useRepositoryStore.getState().openRepository(repo);
      onOpened();
      navigate('/repositories/' + repo.id);
    } catch (failure) {
      if (mounted.current && origin === locationKey.current)
        setMutationError(errorMessage(failure));
    } finally {
      if (mounted.current) setMutationBusy(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setMutationBusy(true);
    setMutationError('');
    try {
      const result = await gitApi.removeWorktree(repoId, removing.path);
      useRepositoryStore.getState().forgetRepositories(result.removedIds);
      setRemoving(null);
      await refresh();
    } catch (failure) {
      setMutationError(errorMessage(failure));
    } finally {
      setMutationBusy(false);
    }
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="worktrees-menu"
      aria-label="关联 Worktree"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div className="worktrees-menu__heading">
        <strong>关联 Worktree</strong>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          aria-label="刷新 Worktree 列表"
          loading={loading}
          disabled={opening !== null}
          onClick={() => void refresh()}
        />
      </div>
      <p className="worktrees-menu__hint">
        在独立标签页打开，并加入仓库列表。关闭标签页会保留目录。
      </p>
      {local && (
        <Button
          block
          icon={<PlusOutlined />}
          disabled={mutationBusy}
          onClick={() => {
            setMutationError('');
            setCreateOpen(true);
          }}
        >
          新建本地 Worktree
        </Button>
      )}
      {loading && <p role="status">正在读取 Worktree…</p>}
      {error && (
        <FeedbackNotice
          source="worktrees-load"
          type="error"
          title={error}
          actionLabel="重试"
          busy={loading || opening !== null}
          onAction={refresh}
        />
      )}
      {items && !items.some((item) => !item.isCurrent) && (
        <p className="worktrees-menu__empty">暂无其他关联 worktree</p>
      )}
      <div className="worktrees-menu__list">
        {items?.map((item) => (
          <div className="worktree-entry" key={item.path}>
            <button
              type="button"
              className="worktree-option"
              key={item.path}
              disabled={item.isCurrent || item.bare || opening !== null || mutationBusy}
              aria-label={'打开 Worktree ' + item.path}
              onClick={() => void openWorktree(item)}
            >
              <span className="worktree-option__heading">
                <strong>
                  {item.bare
                    ? '裸仓库'
                    : item.detached
                      ? '游离 HEAD · ' + item.head?.slice(0, 8)
                      : item.branch || '未命名分支'}
                </strong>
                <small>
                  {item.isCurrent ? (
                    '当前'
                  ) : opening === item.path ? (
                    '正在打开…'
                  ) : (
                    <ExportOutlined />
                  )}
                </small>
              </span>
              <span className="worktree-option__path">{item.path}</span>
              {item.bare && <small>没有可查看改动的工作目录</small>}
              {item.locked && (
                <small>已锁定{item.lockedReason ? ' · ' + item.lockedReason : ''}</small>
              )}
              {item.prunable && (
                <small className="worktree-option__warning">
                  目录可能失效{item.prunableReason ? ' · ' + item.prunableReason : ''}
                </small>
              )}
            </button>
            {local && !item.isCurrent && !item.bare && !item.locked && !item.prunable && (
              <Button
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                disabled={mutationBusy || !!opening}
                aria-label={`删除 Worktree ${item.path}`}
                onClick={() => {
                  setRemoving(item);
                  setMutationError('');
                }}
              >
                删除目录
              </Button>
            )}
          </div>
        ))}
      </div>
      <AluneModal
        open={createOpen}
        size="md"
        glyph="tree"
        eyebrow={{ label: 'Worktree', detail: repoName }}
        title="新建本地 Worktree"
        description="从当前 HEAD 创建新分支和独立的工作目录。请选择当前仓库之外的目录。"
        hintVerb="创建"
        onCancel={() => setCreateOpen(false)}
        onOk={create}
        confirmLoading={mutationBusy}
        okText="创建并打开"
        busyText="正在创建…"
        okDisabled={!newPath || !newBranch.trim()}
      >
        <label className="dlg-fld" htmlFor="worktree-path">
          <span className="dlg-fld-label">完整目录路径</span>
          <Input
            id="worktree-path"
            className="dlg-mono-input"
            data-autofocus
            autoComplete="off"
            spellCheck={false}
            prefix={<DialogIcon name="folder" />}
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
          />
        </label>
        <label className="dlg-fld" htmlFor="worktree-branch">
          <span className="dlg-fld-label">新分支名称</span>
          <Input
            id="worktree-branch"
            className="dlg-mono-input"
            autoComplete="off"
            spellCheck={false}
            prefix={<DialogIcon name="branch" />}
            value={newBranch}
            onChange={(event) => setNewBranch(event.target.value)}
            placeholder="feature/new-worktree"
          />
        </label>
        {newPath.trim() && newBranch.trim() ? (
          <DialogCard>
            <div className="dlg-card-row">
              <span className="dlg-repo-tile" aria-hidden="true">
                <DialogIcon name="tree" />
              </span>
              <div className="dlg-repo-meta">
                <strong>
                  {baseName(newPath.trim())} <span className="dlg-badge">新建</span>
                </strong>
                <DialogPath path={newPath.trim()} />
                <span className="dlg-fld-hint is-ok">
                  <DialogIcon name="branch" />
                  {newBranch.trim()} · 基于当前 HEAD
                </span>
              </div>
            </div>
          </DialogCard>
        ) : null}
        {mutationError && (
          <DialogNote tone="danger" role="alert" title="未能创建 Worktree">
            {mutationError}
          </DialogNote>
        )}
      </AluneModal>
      <AluneModal
        open={!!removing}
        level={2}
        glyph="tree"
        eyebrow={{ label: 'Worktree', detail: repoName }}
        levelLabel="删除磁盘目录"
        title="删除 Worktree 目录？"
        onCancel={() => setRemoving(null)}
        onOk={remove}
        confirmLoading={mutationBusy}
        okText="删除目录"
        okIcon="trash"
        busyText="正在删除…"
        acknowledge="我确认不需要此目录中的文件"
      >
        {removing && (
          <DialogCard>
            <div className="dlg-card-row">
              <span className="dlg-repo-tile" aria-hidden="true">
                <DialogIcon name="tree" />
              </span>
              <div className="dlg-repo-meta">
                <strong>{baseName(removing.path)}</strong>
                <DialogPath path={removing.path} />
                {removing.branch || removing.detached ? (
                  <span className="dlg-fld-hint">
                    <DialogIcon name="branch" />
                    {removing.branch || '游离 HEAD · ' + removing.head?.slice(0, 8)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="dlg-card-divide">
              <div className="dlg-ledger">
                <div data-tone="danger">
                  <h4>将删除</h4>
                  <ul>
                    <li>
                      <DialogIcon name="folder" />
                      <span>磁盘上的工作目录</span>
                    </li>
                    <li>
                      <DialogIcon name="link" />
                      <span>仓库中的 Worktree 登记</span>
                    </li>
                  </ul>
                </div>
                <div data-tone="success">
                  <h4>将保留</h4>
                  <ul>
                    {removing.branch ? (
                      <li>
                        <DialogIcon name="branch" />
                        <span>分支 {removing.branch}</span>
                      </li>
                    ) : null}
                    <li>
                      <DialogIcon name="commit" />
                      <span>已提交的全部内容</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </DialogCard>
        )}
        <DialogNote quiet icon="shield">
          存在改动、未跟踪或忽略文件时会拒绝删除。请先在此 Worktree 中提交或储藏。
        </DialogNote>
        {mutationError && (
          <DialogNote tone="danger" role="alert" title="未能删除目录">
            {mutationError}
          </DialogNote>
        )}
      </AluneModal>
    </section>
  );
}
