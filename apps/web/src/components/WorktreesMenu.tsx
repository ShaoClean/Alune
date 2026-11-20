import { useRef, useState } from 'react';
import { Popover } from '@alune/ui';
import { ClusterOutlined } from '@alune/ui/icons';
import { ToolbarButton } from '@alune/ui';
import { WorktreesPanel } from './WorktreesPanel';
import { useMenuAlign } from '../hooks/useMenuAlign';

export function WorktreesMenu({ repoId }: { repoId: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const { measure, align } = useMenuAlign();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <Popover
      trigger="click"
      align={align}
      arrow={false}
      afterOpenChange={(value) => {
        // A quick interaction may already have focused a child menu while the
        // outer popover is animating. Its late callback must not steal focus.
        if (
          value &&
          (document.activeElement === trigger.current || document.activeElement === document.body)
        )
          panel.current?.focus();
      }}
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) measure(trigger.current);
      }}
      content={
        <WorktreesPanel
          panelRef={panel}
          repoId={repoId}
          active={open}
          onOpened={() => setOpen(false)}
          onDismiss={close}
        />
      }
    >
      <ToolbarButton
        ref={trigger}
        variant="icon"
        className="worktrees-trigger"
        label="查看关联 Worktrees"
        aria-haspopup="dialog"
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) setOpen(true);
          }
        }}
      >
        <ClusterOutlined />
      </ToolbarButton>
    </Popover>
  );
}
