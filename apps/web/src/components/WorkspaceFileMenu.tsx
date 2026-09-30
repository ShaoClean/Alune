import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Alert, App, Button, Dropdown, Input, Modal, Spin } from 'antd';
import type { WorkspaceFilePreview } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

const reason = (error: any) => error.response?.data?.message || error.message || '文件操作失败';
export function absoluteWorkspacePath(root: string, path: string) {
  const windows = /^[a-z]:[\\/]/i.test(root) || root.startsWith('\\\\');
  if (windows && root.includes('\\'))
    return `${root.replace(/[\\/]+$/, '')}\\${path.replace(/\//g, '\\')}`;
  return `${root.replace(/\/+$/, '')}/${path}`;
}

type Target = {
  path: string;
  x: number;
  y: number;
  trigger: HTMLElement;
  session: number;
  allowed: boolean;
};
type Change = (path: string, newPath?: string) => void;

/** Shared by live working-tree rows only; never used by history/PR snapshots. */
export function useWorkspaceFileMenu(repoId: string, onChanged: Change, disabled = false) {
  const [target, setTarget] = useState<Target | null>(null);
  const [dialog, setDialog] = useState<{ target: Target; action: 'delete' | 'rename' } | null>(
    null,
  );
  const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [revision, setRevision] = useState(0);
  const repo = useRepositoryStore(
    (s) =>
      s.repositories.find((r) => r.id === repoId) ||
      (s.currentRepo?.id === repoId ? s.currentRepo : undefined),
  );
  const { message } = App.useApp();
  const active = dialog?.target || target;
  const session = useRef(0);

  useEffect(() => {
    setPreview(null);
    setError('');
    if (!active?.allowed) {
      setChecking(false);
      return;
    }
    let live = true;
    setChecking(true);
    gitApi
      .previewWorkspaceFile(repoId, active.path)
      .then(
        (value) => {
          if (live) setPreview(value);
        },
        (error) => {
          if (live) setError(reason(error));
        },
      )
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [repoId, active?.session, revision]);

  useEffect(() => {
    if (!target) return;
    const dismiss = () => setTarget(null);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [target]);

  const open = (
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    path: string,
    allowed: boolean,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || dialog) return;
    const row = event.currentTarget;
    const button = event.target instanceof HTMLElement ? event.target.closest('button') : null;
    const trigger = button && row.contains(button) ? button : row;
    const rect = trigger.getBoundingClientRect();
    const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
    setTarget({
      path,
      allowed,
      trigger,
      session: ++session.current,
      x: Math.max(8, Math.min(pointer ? event.clientX : rect.left + 16, window.innerWidth - 260)),
      y: Math.max(8, Math.min(pointer ? event.clientY : rect.bottom, window.innerHeight - 270)),
    });
  };
  const bindings = (path: string, allowed = true) => ({
    onContextMenu: (event: MouseEvent<HTMLElement>) => open(event, path, allowed),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
        open(event, path, allowed);
    },
    'aria-haspopup': 'menu' as const,
  });
  const close = (restore = false) => {
    if (restore) target?.trigger.focus();
    setTarget(null);
  };
  const copy = async (relative: boolean) => {
    if (!target) return;
    try {
      if (!relative && !repo?.path) throw new Error('无法读取当前仓库路径');
      if (!navigator.clipboard) throw new Error('当前环境无法访问剪贴板');
      await navigator.clipboard.writeText(
        relative ? target.path : absoluteWorkspacePath(repo!.path, target.path),
      );
      message.success(relative ? '已复制相对路径' : '已复制路径');
    } catch (error) {
      message.error(`复制失败：${reason(error)}`);
    }
  };
  const unavailable = !active?.allowed
    ? '目录、子模块和特殊文件暂不支持修改'
    : checking
      ? '正在核验工作区文件…'
      : error || preview?.reason;
  const canModify = !!preview?.canModify && preview.path === active?.path && !checking && !error;

  return {
    bindings,
    element: (
      <>
        {target && (
          <Dropdown
            key={target.session}
            open
            autoFocus
            trigger={['contextMenu']}
            rootClassName="workspace-file-menu"
            autoAdjustOverflow
            onOpenChange={(value) => {
              if (!value) close();
            }}
            menu={{
              'aria-label': `${target.path} 的文件菜单`,
              selectable: false,
              items: [
                {
                  key: 'heading',
                  disabled: true,
                  label: (
                    <span title={target.path} className="workspace-file-menu__path">
                      {target.path}
                    </span>
                  ),
                },
                { key: 'copy', label: '复制路径' },
                { key: 'relative', label: '复制相对路径' },
                { type: 'divider' },
                { key: 'rename', label: '重命名…', disabled: !canModify, title: unavailable },
                ...(unavailable
                  ? [
                      {
                        key: 'reason',
                        disabled: true,
                        label: <small className="workspace-file-menu__reason">{unavailable}</small>,
                      },
                    ]
                  : []),
                { type: 'divider' },
                {
                  key: 'delete',
                  label: '删除文件…',
                  danger: true,
                  disabled: !canModify,
                  title: unavailable,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'copy' || key === 'relative') void copy(key === 'relative');
                if ((key === 'delete' || key === 'rename') && canModify)
                  setDialog({ target, action: key });
                close();
              },
              onKeyDown: (event) => {
                if (event.key === 'Escape' || event.key === 'Tab') {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                }
              },
            }}
          >
            <span
              className="workspace-file-menu__anchor"
              style={{ left: target.x, top: target.y }}
            />
          </Dropdown>
        )}
        {dialog && (
          <WorkspaceFileDialog
            key={dialog.target.session}
            repoId={repoId}
            path={dialog.target.path}
            action={dialog.action}
            remote={repo?.source !== 'local'}
            preview={preview}
            error={error}
            checking={checking}
            onRetry={() => setRevision((r) => r + 1)}
            onChanged={onChanged}
            onClose={() => {
              dialog.target.trigger.focus();
              setDialog(null);
            }}
          />
        )}
      </>
    ),
  };
}

function WorkspaceFileDialog({
  repoId,
  path,
  action,
  remote,
  preview,
  checking,
  error,
  onRetry,
  onClose,
  onChanged,
}: {
  repoId: string;
  path: string;
  action: 'delete' | 'rename';
  remote: boolean;
  preview: WorkspaceFilePreview | null;
  checking: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onChanged: Change;
}) {
  const [name, setName] = useState(path.slice(path.lastIndexOf('/') + 1));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const { message } = App.useApp();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const deleting = action === 'delete';
  const confirm = async () => {
    if (lock.current || checking || !preview?.canModify || error || failure) return;
    lock.current = true;
    setPending(true);
    let succeeded = false;
    let next: string | undefined;
    try {
      const result = await gitApi.mutateWorkspaceFile(
        repoId,
        path,
        preview.token,
        action,
        deleting ? undefined : name,
      );
      next = result.newPath;
      succeeded = true;
      message.success(deleting ? `已删除 ${path}` : `已重命名为 ${next}`);
    } catch (error) {
      if (mounted.current) setFailure(reason(error));
    } finally {
      // Disconnection may follow a successful remote write: always invalidate.
      if (mounted.current) onChanged(path, next);
      await useRepositoryStore.getState().fetchStatus(repoId, true);
      const status = useRepositoryStore.getState().repositoryStatuses[repoId];
      if (status?.phase === 'error') message.warning(`状态刷新失败：${status.error}`);
      lock.current = false;
      if (mounted.current) {
        setPending(false);
        if (succeeded) onClose();
      }
    }
  };
  return (
    <Modal
      open
      title={deleting ? '删除工作区文件？' : '重命名工作区文件'}
      onCancel={() => {
        if (!lock.current) onClose();
      }}
      closable={!pending}
      keyboard={!pending}
      maskClosable={!pending}
      footer={
        <>
          <Button disabled={pending} onClick={onClose}>
            取消
          </Button>
          {(failure || error) && (
            <Button
              disabled={pending || checking}
              onClick={() => {
                setFailure('');
                onRetry();
              }}
            >
              重新读取并确认
            </Button>
          )}
          <Button
            type="primary"
            danger={deleting}
            loading={pending}
            disabled={
              checking ||
              !preview?.canModify ||
              !!error ||
              !!failure ||
              (!deleting && (!name.trim() || name === path.slice(path.lastIndexOf('/') + 1)))
            }
            onClick={() => void confirm()}
          >
            {deleting ? '永久删除' : '重命名'}
          </Button>
        </>
      }
    >
      <p className="git-path-detail">{preview?.absolutePath || path}</p>
      {checking && (
        <p>
          <Spin size="small" /> 正在核验文件…
        </p>
      )}
      {!deleting && (
        <Input
          autoFocus
          aria-label="新文件名"
          value={name}
          disabled={pending}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void confirm()}
        />
      )}
      {deleting && (
        <p>
          将永久删除{remote ? '远端' : '本地'}
          工作区文件，不会移入回收站。未暂存内容无法撤销；符号链接仅删除链接本身。
        </p>
      )}
      <p>
        仅修改工作区，保留全部暂存内容。
        {preview?.staged ? '此文件已有暂存改动，原暂存版本仍可被提交。' : ''}需要另行暂存此次
        {deleting ? '删除' : '重命名'}。
      </p>
      {(failure || error || preview?.reason) && (
        <Alert
          type="error"
          showIcon
          title="无法完成操作"
          description={failure || error || preview?.reason}
        />
      )}
    </Modal>
  );
}
