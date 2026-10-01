import { Tooltip } from 'antd';

export interface PanelToggleProps {
  side: 'left' | 'right';
  expanded: boolean;
  controls: string;
  onClick: () => void;
  disabled?: boolean;
  panelName?: string;
}

export function PanelToggle({
  side,
  expanded,
  controls,
  onClick,
  disabled = false,
  panelName,
}: PanelToggleProps) {
  const label = `${expanded ? '隐藏' : '显示'}${panelName || (side === 'left' ? '左侧工作区' : '右侧面板')}`;
  return (
    <Tooltip
      title={
        disabled ? '当前视图没有右侧面板' : `${label} · ⌘ / Ctrl ${side === 'right' ? '⇧ ' : ''}B`
      }
      trigger={['hover', 'focus']}
      placement="bottom"
    >
      <button
        type="button"
        className="panel-toggle"
        aria-disabled={disabled || undefined}
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-keyshortcuts={side === 'left' ? 'Meta+B Control+B' : 'Meta+Shift+B Control+Shift+B'}
        onClick={() => {
          // Keep unavailable panels focusable so keyboard users can read the reason.
          if (!disabled) onClick();
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          {expanded && (
            <path
              d={side === 'left' ? 'M3 3h4v14H3z' : 'M13 3h4v14h-4z'}
              fill="currentColor"
              opacity=".12"
              stroke="none"
            />
          )}
          <rect x="2.5" y="3" width="15" height="14" rx="2" />
          <path d={side === 'left' ? 'M7 3v14' : 'M13 3v14'} />
        </svg>
      </button>
    </Tooltip>
  );
}
