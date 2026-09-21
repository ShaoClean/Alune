import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Button } from 'antd';
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorktreeInfo } from '@alune/shared';
import { repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

const errorMessage = (error: any) =>
  error.response?.data?.message || error.message || '远程读取失败';

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
      <p className="worktrees-menu__hint">在独立标签页打开，并加入仓库列表</p>
      {loading && <p role="status">正在读取 Worktree…</p>}
      {error && (
        <div className="worktrees-menu__error" role="alert">
          <span>{error}</span>
          <Button size="small" disabled={loading || opening !== null} onClick={() => void refresh()}>
            重试
          </Button>
        </div>
      )}
      {items && !items.some((item) => !item.isCurrent) && (
        <p className="worktrees-menu__empty">暂无其他关联 worktree</p>
      )}
      <div className="worktrees-menu__list">
        {items?.map((item) => (
          <button
            type="button"
            className="worktree-option"
            key={item.path}
            disabled={item.isCurrent || item.bare || opening !== null}
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
        ))}
      </div>
    </section>
  );
}
