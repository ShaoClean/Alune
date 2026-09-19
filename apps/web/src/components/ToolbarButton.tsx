import type { ComponentProps } from 'react';
import { Tooltip } from 'antd';

// Variants separate the three kinds of toolbar entries: navigation switches the main view,
// action runs a remote command, primary is the single emphasised action (push).
export type ToolbarButtonVariant = 'nav' | 'action' | 'primary' | 'icon';

export function ToolbarButton({
  label,
  tooltip = label,
  active = false,
  variant = 'nav',
  className = '',
  ...props
}: ComponentProps<'button'> & {
  label: string;
  tooltip?: string;
  active?: boolean;
  variant?: ToolbarButtonVariant;
}) {
  return (
    <Tooltip title={tooltip} trigger={['hover', 'focus']} placement="bottom">
      <button
        {...props}
        type="button"
        className={`toolbar-button toolbar-button--${variant}${active ? ' toolbar-button--active' : ''}${className ? ` ${className}` : ''}`}
        aria-label={label}
      />
    </Tooltip>
  );
}
