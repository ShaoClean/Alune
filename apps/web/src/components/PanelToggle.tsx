interface Props {
  side: 'left' | 'right';
  expanded: boolean;
  controls: string;
  onClick: () => void;
  disabled?: boolean;
}

export function PanelToggle({ side, expanded, controls, onClick, disabled = false }: Props) {
  const label = `${expanded ? '隐藏' : '显示'}${side === 'left' ? '左侧工作区' : '右侧面板'}`;
  return (
    <button
      type="button"
      className="panel-toggle"
      disabled={disabled}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-keyshortcuts={side === 'left' ? 'Meta+B Control+B' : 'Meta+Shift+B Control+Shift+B'}
      title={
        disabled ? '当前视图没有右侧面板' : `${label} · ⌘ / Ctrl ${side === 'right' ? '⇧ ' : ''}B`
      }
      onClick={onClick}
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
  );
}
