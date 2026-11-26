import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export type DropEdge = 'left' | 'right' | 'top' | 'bottom';
type Target =
  | { kind: 'sort'; at: number; marker: string; after: boolean }
  | { kind: 'pane'; edge: DropEdge | 'center' };
export function useTerminalTabDrag(
  tabs: RefObject<HTMLDivElement | null>,
  panes: RefObject<HTMLDivElement | null>,
  onMove: (id: string, index: number) => void,
  onSplit: (id: string, edge: DropEdge) => void,
  canSplit: boolean,
) {
  const [preview, setPreview] = useState<Target | null>(null);
  const [dragged, setDragged] = useState('');
  const cancel = useRef<(() => void) | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => () => cancel.current?.(), []);
  function start(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (!e.isPrimary || e.button !== 0) return;
    cancel.current?.();
    suppressClick.current = false;
    const strip = tabs.current,
      area = panes.current;
    if (!strip || !area) return;
    const button = e.currentTarget,
      pointer = e.pointerId,
      startX = e.clientX,
      startY = e.clientY;
    let moving = false,
      frame = 0,
      x = startX,
      y = startY;
    let hold: ReturnType<typeof setTimeout> | undefined;
    function hit(): Target | null {
      const r = strip!.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 2 && y <= r.bottom + 2) {
        const others = [...strip!.querySelectorAll<HTMLElement>('[data-session]')].filter(
          (el) => el.dataset.session !== id,
        );
        if (!others.length) return null;
        const before = others.findIndex((el) => {
          const b = el.getBoundingClientRect();
          return x < b.left + b.width / 2;
        });
        const after = before < 0;
        return {
          kind: 'sort',
          at: after ? others.length : before,
          marker: others[after ? others.length - 1 : before].dataset.session!,
          after,
        };
      }
      const b = area!.getBoundingClientRect();
      if (
        !canSplit ||
        !b.width ||
        !b.height ||
        x < b.left ||
        x > b.right ||
        y < b.top ||
        y > b.bottom
      )
        return null;
      const dx = (x - b.left) / b.width,
        dy = (y - b.top) / b.height;
      const min = Math.min(dx, 1 - dx, dy, 1 - dy);
      const edge =
        min > 0.28
          ? 'center'
          : min === dx
            ? 'left'
            : min === 1 - dx
              ? 'right'
              : min === dy
                ? 'top'
                : 'bottom';
      return { kind: 'pane', edge };
    }
    function update() {
      cancelAnimationFrame(frame);
      const target = hit();
      setPreview(target);
      if (target?.kind !== 'sort') return;
      const r = strip!.getBoundingClientRect();
      const delta = x < r.left + 18 ? -5 : x > r.right - 18 ? 5 : 0;
      const before = strip!.scrollLeft;
      strip!.scrollLeft += delta;
      if (before !== strip!.scrollLeft) frame = requestAnimationFrame(update);
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      x = event.clientX;
      y = event.clientY;
      if (!moving) {
        if (Math.hypot(x - startX, y - startY) < 5) return;
        clearTimeout(hold);
        moving = true;
        suppressClick.current = true;
        button.setPointerCapture(pointer);
        setDragged(id);
      }
      update();
    }
    function finish() {
      clearTimeout(hold);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      window.removeEventListener('keydown', escape, true);
      if (button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
      setPreview(null);
      setDragged('');
      cancel.current = undefined;
    }
    function up(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      x = event.clientX;
      y = event.clientY;
      const target = moving ? hit() : null;
      finish();
      if (target?.kind === 'sort') onMove(id, target.at);
      if (target?.kind === 'pane' && target.edge !== 'center') onSplit(id, target.edge);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
    }
    cancel.current = finish;
    if (e.pointerType === 'touch')
      hold = setTimeout(() => {
        finish();
        suppressClick.current = true;
        button.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: startX,
            clientY: startY,
          }),
        );
      }, 550);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    window.addEventListener('keydown', escape, true);
  }
  return { start, preview, dragged, suppressClick };
}
