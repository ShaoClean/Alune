import type { ComponentProps } from 'react';
import { Tooltip } from 'antd';

export function StatusButton({
  label,
  tooltip = label,
  active = false,
  className = '',
  ...props
}: ComponentProps<'button'> & { label: string; tooltip?: string; active?: boolean }) {
  return (
    <Tooltip title={tooltip} trigger={['hover', 'focus']} placement="top">
      <button
        {...props}
        type="button"
        className={`status-button${active ? ' status-button--active' : ''} ${className}`}
        aria-label={label}
      />
    </Tooltip>
  );
}
