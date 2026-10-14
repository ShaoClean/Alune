import type { ComponentProps, ReactNode } from 'react';
import { Tooltip } from 'antd';

// Variants separate the three kinds of toolbar entries: navigation switches the main view,
// action runs a remote command, primary is the single emphasised action (push).
export type ToolbarButtonVariant = 'nav' | 'action' | 'primary' | 'icon';

/** Mono count pill for ahead / behind commits; `behind` paints it orange. */
export function ToolbarCount({ tone, children }: ToolbarCountProps) {
  return (
    <span className={tone === 'behind' ? 'toolbar-count toolbar-count--behind' : 'toolbar-count'}>
      {children}
    </span>
  );
}

export function ToolbarButton({
  label,
  tooltip = label,
  active = false,
  variant = 'nav',
  text,
  count,
  countTone,
  className = '',
  children,
  ...props
}: ToolbarButtonProps) {
  return (
    <Tooltip title={tooltip} trigger={['hover', 'focus']} placement="bottom">
      <button
        {...props}
        type="button"
        className={`toolbar-button toolbar-button--${variant}${active ? ' toolbar-button--active' : ''}${className ? ` ${className}` : ''}`}
        aria-label={label}
      >
        {children}
        {text === undefined || text === null || text === false ? null : (
          <span className="toolbar-button__label">{text}</span>
        )}
        {count === undefined || count === null || count === false ? null : (
          <ToolbarCount tone={countTone}>{count}</ToolbarCount>
        )}
      </button>
    </Tooltip>
  );
}

export type ToolbarButtonProps = ComponentProps<'button'> & {
  label: string;
  tooltip?: string;
  active?: boolean;
  variant?: ToolbarButtonVariant;
  /** Visible text after the icon; omit for icon-only buttons. */
  text?: ReactNode;
  /** Trailing count such as commits ahead or behind. */
  count?: ReactNode;
  countTone?: ToolbarCountProps['tone'];
};

export type ToolbarCountProps = { tone?: 'behind'; children: ReactNode };
