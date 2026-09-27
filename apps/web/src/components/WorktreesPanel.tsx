import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Button, Checkbox, Input, Modal } from 'antd';
import { DeleteOutlined, PlusOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorktreeInfo } from '@alune/shared';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

const errorMessage = (error: any) => error.response?.data?.message || error.message || '读取失败';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);
  const [confirmed, setConfirmed] = useState(false);
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
    if (!removing || !confirmed) return;
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
        <div className="worktrees-menu__error" role="alert">
          <span>{error}</span>
          <Button
            size="small"
            disabled={loading || opening !== null}
            onClick={() => void refresh()}
          >
            重试
          </Button>
        </div>
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
                  setConfirmed(false);
                  setMutationError('');
                }}
              >
                删除目录
              </Button>
            )}
          </div>
        ))}
      </div>
      <Modal
        title="新建本地 Worktree"
        open={createOpen}
        onCancel={() => {
          if (!mutationBusy) setCreateOpen(false);
        }}
        onOk={() => void create()}
        confirmLoading={mutationBusy}
        okText="创建并打开"
        okButtonProps={{ disabled: !newPath || !newBranch.trim() }}
      >
        <p className="modal-description">
          从当前 HEAD 创建新分支和独立工作目录。请选择当前仓库之外的目录。
        </p>
        <label className="git-form-label" htmlFor="worktree-path">
          完整目录路径
        </label>
        <Input
          id="worktree-path"
          value={newPath}
          onChange={(event) => setNewPath(event.target.value)}
        />
        <label className="git-form-label" htmlFor="worktree-branch">
          新分支名称
        </label>
        <Input
          id="worktree-branch"
          value={newBranch}
          onChange={(event) => setNewBranch(event.target.value)}
          placeholder="feature/new-worktree"
        />
        {mutationError && (
          <p role="alert" className="worktrees-menu__error">
            {mutationError}
          </p>
        )}
      </Modal>
      <Modal
        title="删除 Worktree 目录？"
        open={!!removing}
        onCancel={() => {
          if (!mutationBusy) setRemoving(null);
        }}
        onOk={() => void remove()}
        confirmLoading={mutationBusy}
        okText="删除目录"
        okButtonProps={{ danger: true, disabled: !confirmed }}
      >
        <p className="git-path-detail">{removing?.path}</p>
        <p>
          将删除磁盘上的工作目录并移除仓库登记，保留分支。存在改动、未跟踪或忽略文件时会拒绝删除。
        </p>
        <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>
          我确认不需要此目录中的文件
        </Checkbox>
        {mutationError && (
          <p role="alert" className="worktrees-menu__error">
            {mutationError}
          </p>
        )}
      </Modal>
    </section>
  );
}
