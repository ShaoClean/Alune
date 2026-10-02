import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Button, Dropdown, Input } from '@alune/ui';
import type { WorkspaceFilePreview } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneModal } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogLedger, DialogNote, DialogProgress, RepoRow } from '@alune/ui';

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
  const message = useFeedbackMessage();
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
                  type: 'group',
                  label: (
                    <span title={target.path} className="workspace-file-menu__path">
                      {target.path}
                    </span>
                  ),
                },
                { key: 'copy', icon: <DialogIcon name="copy" />, label: '复制路径' },
                { key: 'relative', icon: <DialogIcon name="link" />, label: '复制相对路径' },
                { type: 'divider' },
                {
                  key: 'rename',
                  icon: <DialogIcon name="pencil" />,
                  label: '重命名…',
                  disabled: !canModify,
                  title: unavailable,
                },
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
                  icon: <DialogIcon name="trash" />,
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
            remote={repo?.source === 'ssh'}
            repoName={repo?.name}
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
  repoName,
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
  repoName?: string;
  preview: WorkspaceFilePreview | null;
  checking: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onChanged: Change;
}) {
  const originalName = path.slice(path.lastIndexOf('/') + 1);
  const [name, setName] = useState(originalName);
  const [open, setOpen] = useState(true);
  const nameHintId = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const message = useFeedbackMessage();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const deleting = action === 'delete';
  const nameError = !name.trim()
    ? '请输入新文件名'
    : name === '.' || name === '..' || name.toLowerCase() === '.git' || /[/\x00]/.test(name)
      ? '请输入有效的单个文件名，不能包含 / 或使用 .git'
      : '';
  const unchanged = name === originalName;
  const blocked = checking || !preview?.canModify || !!error || !!failure;
  const canConfirm = !blocked && (deleting || (!nameError && !unchanged));
  const confirm = async () => {
    if (lock.current || !canConfirm || !preview) return;
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
        if (succeeded) setOpen(false);
      }
    }
  };
  return (
    <AluneModal
      open={open}
      level={deleting ? 2 : 0}
      glyph={deleting ? 'trash' : 'pencil'}
      eyebrow={{ label: remote ? 'SSH' : '本地', detail: repoName }}
      title={deleting ? '删除工作区文件？' : '重命名工作区文件'}
      onCancel={() => {
        if (!lock.current) setOpen(false);
      }}
      afterClose={onClose}
      focusTriggerAfterClose={false}
      onOk={() => void confirm()}
      confirmLoading={pending}
      busyText={deleting ? '正在删除…' : '正在重命名…'}
      okText={deleting ? '永久删除' : '重命名'}
      hintVerb="重命名"
      okIcon={deleting ? 'trash' : 'arrow-right'}
      okDisabled={!canConfirm}
      acknowledge={deleting && !blocked ? `我确认永久删除 ${originalName}` : undefined}
      extra={
        failure || error ? (
          <Button
            disabled={pending || checking}
            onClick={() => {
              setFailure('');
              onRetry();
            }}
          >
            重新读取并确认
          </Button>
        ) : null
      }
    >
      <DialogCard>
        <RepoRow name={originalName} path={preview?.absolutePath || path} icon="file" />
      </DialogCard>
      {checking && <DialogProgress label="正在核验工作区文件与暂存内容…" />}
      {!deleting && (
        <label className="dlg-fld">
          <span className="dlg-fld-label">新文件名</span>
          <Input
            autoFocus
            className="dlg-mono-input"
            prefix={<DialogIcon name="pencil" />}
            aria-label="新文件名"
            aria-describedby={nameHintId}
            aria-invalid={!!nameError || undefined}
            status={nameError ? 'error' : undefined}
            value={name}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
          <span
            id={nameHintId}
            className={nameError ? 'dlg-fld-hint is-error' : 'dlg-fld-hint'}
            role="status"
          >
            {nameError || (unchanged ? '名称未变化' : '在当前目录内重命名，不覆盖已有文件。')}
          </span>
        </label>
      )}
      {deleting ? (
        <>
          <DialogLedger
            changeTitle="将删除"
            change={[
              { icon: 'trash', text: `${remote ? '远端' : '本地'}工作区文件及未暂存内容` },
              { icon: 'link', text: '符号链接仅删除链接本身' },
            ]}
            keep={[
              { icon: 'archive', text: '全部暂存内容，原暂存版本仍可被提交' },
              { icon: 'commit', text: '已有提交与历史记录' },
            ]}
          />
          <DialogNote tone="danger">直接永久删除，不会移入回收站；未暂存内容无法撤销。</DialogNote>
        </>
      ) : (
        <DialogNote quiet>
          仅修改工作区，保留全部暂存内容。
          {preview?.staged ? '此文件已有暂存改动，原暂存版本仍可被提交。' : ''}
        </DialogNote>
      )}
      <p className="dlg-text">需要另行暂存此次{deleting ? '删除' : '重命名'}。</p>
      {(failure || error || preview?.reason) && (
        <DialogNote tone="danger" role="alert" title="无法完成操作">
          {failure || error || preview?.reason}
        </DialogNote>
      )}
    </AluneModal>
  );
}
