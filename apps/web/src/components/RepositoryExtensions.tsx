import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@alune/ui';
import type { LfsStatus, SubmoduleInfo } from '@alune/shared';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

const message = (error: unknown) => (error instanceof Error ? error.message : '读取失败，请重试。');
const labels = {
  uninitialized: '未初始化',
  current: '提交一致',
  changed: '指针变化',
  conflict: '指针冲突',
};

export function RepositoryExtensions({
  repoId,
  revision,
  onChanged,
}: {
  repoId: string;
  revision: string;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<SubmoduleInfo[]>([]);
  const [lfs, setLfs] = useState<LfsStatus | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const origin = useRef(location.key);
  origin.current = location.key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void Promise.allSettled([
      repositoryApi.submodules(repoId, controller.signal),
      repositoryApi.lfs(repoId, controller.signal),
    ]).then(([modules, status]) => {
      if (controller.signal.aborted) return;
      setItems(modules.status === 'fulfilled' ? modules.value : []);
      setLfs(status.status === 'fulfilled' ? status.value : null);
      const failures = [modules, status].filter((result) => result.status === 'rejected');
      setError(
        failures.map((result) => message((result as PromiseRejectedResult).reason)).join('；'),
      );
    });
    return () => {
      controller.abort();
    };
  }, [repoId, revision, refresh]);

  const act = async (action: 'update' | 'sync' | 'open', path?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    const locationKey = origin.current;
    try {
      if (action === 'open') {
        const repo = await repositoryApi.openSubmodule(repoId, path!);
        useRepositoryStore.getState().registerRepository(repo);
        if (!mounted.current || origin.current !== locationKey) return;
        useRepositoryStore.getState().openRepository(repo);
        navigate('/repositories/' + repo.id);
      } else {
        await gitApi.submodules(repoId, action);
      }
    } catch (failure) {
      if (mounted.current && origin.current === locationKey) setActionError(message(failure));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
      // Partial updates can succeed even when a later nested checkout fails.
      if (mounted.current && origin.current === locationKey) {
        setRefresh((value) => value + 1);
        if (action !== 'open') {
          onChanged();
          void useRepositoryStore.getState().fetchStatus(repoId, true);
        }
      }
    }
  };

  if (!items.length && !lfs?.used && !error && !actionError) return null;
  return (
    <section className="repository-extensions" aria-label="子模块与 LFS">
      {actionError && <p role="alert">{actionError}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button size="small" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
            重试
          </Button>
        </div>
      )}
      {!!items.length && (
        <details open>
          <summary>
            子模块 <span>{items.length}</span>
          </summary>
          <div className="repository-extensions__actions">
            <Button size="small" loading={busy} disabled={busy} onClick={() => void act('update')}>
              初始化 / 更新
            </Button>
            <Button size="small" disabled={busy} onClick={() => void act('sync')}>
              同步 URL
            </Button>
          </div>
          <ul>
            {items.map((item) => (
              <li key={item.path}>
                <strong title={item.path}>{item.path}</strong>
                <span>
                  {labels[item.status]}
                  {item.dirty ? ' · 有未提交改动' : ''}
                </span>
                <span title={item.currentCommit ?? undefined}>
                  当前 {item.currentCommit?.slice(0, 12) ?? '—'}
                </span>
                <span title={item.recordedCommit}>记录 {item.recordedCommit.slice(0, 12)}</span>
                <Button
                  size="small"
                  disabled={busy || !item.initialized}
                  onClick={() => void act('open', item.path)}
                  aria-label={`在新标签中打开子模块 ${item.path}`}
                >
                  在新标签中打开
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {lfs?.used && (
        <div className="repository-extensions__lfs" role="status">
          <strong>Git LFS</strong>
          <p>{lfs.message || `${lfs.version} · 已就绪`}</p>
        </div>
      )}
    </section>
  );
}
