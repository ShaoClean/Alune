import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Popconfirm } from 'antd';
import type { PopconfirmProps } from 'antd';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';
import { DialogPath } from './DialogParts';

/**
 * Anchored confirmation for one object (spec P01–P06). `safe` is the blue L0
 * form for reversible removals, `warning` is L1 with a soft red action and
 * `danger` a solid red action for single-file discards that need an
 * acknowledgement. Anything wider or irreversible belongs in an L2
 * AluneModal instead.
 */
export function AlunePopconfirm({
  title,
  description,
  extra,
  icon,
  tone = 'warning',
  okText,
  okDisabled,
  hint,
  onConfirm,
  onOpenChange,
  placement,
  disabled,
  wide,
  focus = 'ok',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  icon: DialogIconName;
  tone?: 'safe' | 'warning' | 'danger';
  okText: string;
  okDisabled?: boolean;
  hint?: ReactNode;
  onConfirm: () => unknown;
  onOpenChange?: (open: boolean) => void;
  placement?: PopconfirmProps['placement'];
  disabled?: boolean;
  wide?: boolean;
  /** What receives focus on open: the action, or the first control in `extra`. */
  focus?: 'ok' | 'extra';
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const change = (next: boolean) => {
    if (next) {
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    // Wait for the portal, then move focus inside so Tab and Esc work from the keyboard.
    const frame = requestAnimationFrame(() => {
      const root = body.current?.closest<HTMLElement>('.ant-popover');
      const target =
        focus === 'extra'
          ? root?.querySelector<HTMLElement>('.a-pop-extra input, .a-pop-extra button')
          : root?.querySelector<HTMLElement>('.ant-popconfirm-buttons .ant-btn:last-child');
      (target ?? root?.querySelector<HTMLElement>('.ant-popconfirm-buttons .ant-btn'))?.focus();
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      change(false);
    };
    document.addEventListener('keydown', escape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', escape, true);
      // Return focus to the trigger unless the user already moved it elsewhere.
      const active = document.activeElement;
      const root = body.current?.closest('.ant-popover');
      if (!active || active === document.body || root?.contains(active)) {
        const node = trigger.current;
        if (node?.isConnected) requestAnimationFrame(() => node.focus());
      }
    };
    // `change` is stable enough for this effect; only open/focus matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focus]);

  const toneClass = tone === 'safe' ? 'is-safe' : tone === 'warning' ? 'is-warning' : '';
  return (
    <Popconfirm
      open={open}
      onOpenChange={change}
      disabled={disabled}
      placement={placement}
      rootClassName={[toneClass, wide ? 'is-wide' : ''].filter(Boolean).join(' ') || undefined}
      icon={<DialogIcon name={icon} />}
      title={title}
      description={
        <div ref={body} className="a-pop-body">
          {description ? <p>{description}</p> : null}
          {extra ? <div className="a-pop-extra">{extra}</div> : null}
          {hint ? <p className="a-pop-hint">{hint}</p> : null}
        </div>
      }
      okText={okText}
      cancelText="取消"
      okButtonProps={{
        size: 'small',
        disabled: okDisabled,
        danger: tone !== 'safe',
        type: tone === 'warning' ? 'default' : 'primary',
        autoInsertSpace: false,
      }}
      cancelButtonProps={{ size: 'small', type: 'text', autoInsertSpace: false }}
      onConfirm={() => onConfirm()}
    >
      {children}
    </Popconfirm>
  );
}

/** P05: the repository list and the workspace tree share one removal prompt. */
export function RemoveRepositoryConfirm({
  repository,
  onConfirm,
  placement,
  disabled,
  children,
}: {
  repository: { name: string; path: string };
  onConfirm: () => unknown;
  placement?: PopconfirmProps['placement'];
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <AlunePopconfirm
      tone="safe"
      icon="folder"
      title={`从列表移除“${repository.name}”？`}
      description="只移除应用内登记，仓库目录与文件保持不变，之后可以重新打开。"
      extra={<DialogPath path={repository.path} />}
      okText="移除登记"
      placement={placement}
      disabled={disabled}
      onConfirm={onConfirm}
    >
      {children}
    </AlunePopconfirm>
  );
}
