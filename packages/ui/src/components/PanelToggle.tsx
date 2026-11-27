import { Tooltip } from 'antd';

export interface PanelToggleProps {
  side: 'left' | 'right';
  expanded: boolean;
  controls: string;
  onClick: () => void;
  disabled?: boolean;
  panelName?: string;
  /** Set false for a local panel without the workspace keyboard shortcut. */
  workspaceShortcut?: boolean;
}

export function PanelToggle({
  side,
  expanded,
  controls,
  onClick,
  disabled = false,
  panelName,
  workspaceShortcut = true,
}: PanelToggleProps) {
  const label = `${expanded ? '隐藏' : '显示'}${panelName || (side === 'left' ? '左侧工作区' : '右侧面板')}`;
  return (
    <Tooltip
      title={
        disabled
          ? '当前视图没有右侧面板'
          : !workspaceShortcut
            ? label
            : `${label} · ⌘ / Ctrl ${side === 'right' ? '⇧ ' : ''}B`
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
        aria-keyshortcuts={
          workspaceShortcut
            ? side === 'left'
              ? 'Meta+B Control+B'
              : 'Meta+Shift+B Control+Shift+B'
            : undefined
        }
        onClick={() => {
          // Keep unavailable panels focusable so keyboard users can read the reason.
          if (!disabled) onClick();
        }}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {expanded && (
            <path
              d={
                side === 'left'
                  ? 'M6.5 4.5h2.7v15H6.5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z'
                  : 'M14.8 4.5h2.7a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-2.7v-15Z'
              }
              className="alune-ic__duo"
            />
          )}
          <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
          <path d={side === 'left' ? 'M9.2 4.5v15' : 'M14.8 4.5v15'} />
        </svg>
      </button>
    </Tooltip>
  );
}
