import { useRef, useState } from 'react';
import { clampWidth } from '../stores/workspaceLayout';

interface Props {
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  className?: string;
}

export function PanelResizeHandle({
  label,
  controls,
  value,
  min,
  max,
  onChange,
  className = '',
}: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`panel-resize-handle ${className}${dragging ? ' panel-resize-handle--dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${value} 像素`}
      title={`${label}；方向键调整，Shift 加速，Home / End 调到边界`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width: value };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (start.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
          onChange(clampWidth(start.current.width + event.clientX - start.current.x, min, max));
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const next =
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : event.key === 'ArrowLeft'
                ? value - step
                : event.key === 'ArrowRight'
                  ? value + step
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        onChange(clampWidth(next, min, max));
      }}
    />
  );
}
