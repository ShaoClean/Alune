import { useEffect, useRef, useState } from 'react';
import { CopyOutlined, DeleteOutlined, MoreOutlined } from '@ant-design/icons';
import { Popover, useFeedbackMessage } from '@alune/ui';
import type { Repository } from '@alune/shared';
import { RemoveRepositoryConfirm } from './AlunePopconfirm';

export function WorkspaceRepositoryActions({
  repo,
  accessibleName,
  busy,
  onRemove,
}: {
  repo: Repository;
  accessibleName: string;
  busy: boolean;
  onRemove: () => Promise<void>;
}) {
  const message = useFeedbackMessage();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || confirming) return;
    const frame = requestAnimationFrame(() => content.current?.querySelector('button')?.focus());
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open, confirming]);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!confirming) setOpen(next);
      }}
      trigger="click"
      placement="rightTop"
      classNames={{ root: 'workspace-actions-popover' }}
      content={
        <div
          ref={content}
          className="workspace-actions"
          role="group"
          aria-label={`${accessibleName} 的操作`}
        >
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(repo.path);
                setOpen(false);
                trigger.current?.focus();
              } catch {
                message.error('无法复制路径，请检查剪贴板权限');
              }
            }}
          >
            <CopyOutlined aria-hidden />
            复制完整路径
          </button>
          <RemoveRepositoryConfirm
            repository={repo}
            placement="right"
            disabled={busy}
            onOpenChange={setConfirming}
            onConfirm={async () => {
              await onRemove();
              setConfirming(false);
              setOpen(false);
            }}
          >
            <button type="button" disabled={busy}>
              <DeleteOutlined aria-hidden />
              移除仓库登记
            </button>
          </RemoveRepositoryConfirm>
        </div>
      }
    >
      <button
        ref={trigger}
        type="button"
        className={`tree-node__more${open ? ' tree-node__more--open' : ''}`}
        aria-label={`更多操作 ${accessibleName}`}
        aria-expanded={open}
        aria-busy={busy}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreOutlined aria-hidden />
      </button>
    </Popover>
  );
}
