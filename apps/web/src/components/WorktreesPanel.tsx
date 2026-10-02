import { FeedbackNotice } from '@alune/ui';
import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Button, Dropdown, Input, Tooltip } from '@alune/ui';
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
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const moreButtons = useRef(new Map<string, HTMLElement>());
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

  const currentItems = items?.filter((item) => item.isCurrent) ?? [];
  const otherItems = items?.filter((item) => !item.isCurrent) ?? [];
  const renderEntry = (item: WorktreeInfo) => {
    const label = item.bare
      ? '裸仓库'
      : item.detached
        ? '游离 HEAD · ' + (item.head?.slice(0, 8) || '未知提交')
        : item.branch || '未命名分支';
    const canRemove = local && !item.isCurrent && !item.bare && !item.locked && !item.prunable;

    return (
      <Tooltip
        key={item.path}
        title={
          <>
            <div>{label}</div>
            <div>{item.path}</div>
          </>
        }
        mouseEnterDelay={0.5}
        open={menuPath === item.path ? false : undefined}
      >
        <li
          className={`worktree-entry${item.isCurrent ? ' worktree-entry--current' : ''}`}
          aria-current={item.isCurrent ? 'true' : undefined}
        >
          <button
            type="button"
            className="worktree-option"
            disabled={item.isCurrent || item.bare || opening !== null || mutationBusy}
            aria-label={(item.isCurrent ? '当前 Worktree ' : '打开 Worktree ') + item.path}
            onClick={() => void openWorktree(item)}
          >
            <span className="worktree-option__icon">
              <DialogIcon name={item.bare ? 'folder' : item.detached ? 'commit' : 'branch'} />
            </span>
            <span className="worktree-option__copy">
              <strong className="worktree-option__name">{label}</strong>
              <span className="worktree-option__path">{item.path}</span>
              {item.bare && <span className="worktree-option__note">没有可查看改动的工作目录</span>}
              {item.locked && (
                <span className="worktree-option__note">
                  <DialogIcon name="lock" />
                  已锁定{item.lockedReason ? ' · ' + item.lockedReason : ''}
                </span>
              )}
              {item.prunable && (
                <span className="worktree-option__note worktree-option__warning">
                  <DialogIcon name="warning" />
                  目录可能失效{item.prunableReason ? ' · ' + item.prunableReason : ''}
                </span>
              )}
            </span>
            {item.isCurrent ? (
              <span className="worktree-option__current">
                <DialogIcon name="check" />
              </span>
            ) : opening === item.path ? (
              <span className="worktree-option__opening" role="status">
                正在打开…
              </span>
            ) : !item.bare ? (
              <span className="worktree-option__open" aria-hidden="true">
                <DialogIcon name="arrow-up-right" />
              </span>
            ) : null}
          </button>
          {canRemove && (
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              autoFocus
              open={menuPath === item.path}
              onOpenChange={(value) => setMenuPath(value ? item.path : null)}
              menu={{
                'aria-label': `${label} 的 Worktree 操作`,
                selectable: false,
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setMenuPath(null);
                    moreButtons.current.get(item.path)?.focus();
                  }
                },
                items: [
                  {
                    key: 'remove',
                    label: '删除目录…',
                    icon: <DialogIcon name="trash" />,
                    danger: true,
                  },
                ],
                onClick: () => {
                  moreButtons.current.get(item.path)?.focus();
                  setMenuPath(null);
                  setRemoving(item);
                  setMutationError('');
                },
              }}
            >
              <Button
                ref={(node) => {
                  if (node) moreButtons.current.set(item.path, node);
                  else moreButtons.current.delete(item.path);
                }}
                className="worktree-entry__more"
                type="text"
                size="small"
                icon={<DialogIcon name="dots" />}
                disabled={mutationBusy || opening !== null}
                aria-label={`Worktree 更多操作 ${item.path}`}
                title="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuPath === item.path}
              />
            </Dropdown>
          )}
        </li>
      </Tooltip>
    );
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="worktrees-menu"
      aria-label="关联 Worktree"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !menuPath &&
          !createOpen &&
          !removing
        ) {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div className="worktrees-menu__heading">
        <div className="worktrees-menu__title">
          <strong>关联 Worktree</strong>
          <span title={repoName}>
            {repoName ? `${repoName} · ` : ''}
            {local ? '本地仓库' : 'SSH 仓库'}
          </span>
        </div>
        <div className="worktrees-menu__actions">
          <Button
            type="text"
            size="small"
            icon={<DialogIcon name="refresh" />}
            aria-label="刷新 Worktree 列表"
            title="刷新列表"
            loading={loading}
            disabled={opening !== null || mutationBusy}
            onClick={() => void refresh()}
          />
          {local && (
            <Button
              type="primary"
              size="small"
              icon={<DialogIcon name="plus" />}
              aria-label="新建本地 Worktree"
              disabled={mutationBusy || opening !== null}
              onClick={() => {
                setMutationError('');
                setCreateOpen(true);
              }}
            >
              新建
            </Button>
          )}
        </div>
      </div>
      {loading && (
        <p className="worktrees-menu__empty" role="status">
          正在读取 Worktree…
        </p>
      )}
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
      {!!currentItems.length && (
        <div className="worktrees-menu__current">
          <h3 className="worktrees-menu__label">当前工作区</h3>
          <ul>{currentItems.map(renderEntry)}</ul>
        </div>
      )}
      {items && (
        <div className="worktrees-menu__others">
          <h3 className="worktrees-menu__label">
            其他工作区 <span>{otherItems.length}</span>
          </h3>
          {otherItems.length ? (
            <ul className="worktrees-menu__list">{otherItems.map(renderEntry)}</ul>
          ) : (
            <p className="worktrees-menu__empty">暂无其他关联 worktree</p>
          )}
        </div>
      )}
      <p className="worktrees-menu__hint">
        <DialogIcon name="info" />
        <span>在独立标签页打开并加入仓库列表，关闭标签保留目录。</span>
      </p>
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
