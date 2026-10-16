import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

const FLASH_MS = 1200;
const NOTICE_MS = 1600;
const TEXT_ENTRY =
  'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

// Rows carry `data-change="<segment>"`; a split row pairs both sides of one segment.
function segmentRows(body: HTMLElement) {
  const rows = new Map<number, HTMLElement[]>();
  body.querySelectorAll<HTMLElement>('[data-change]').forEach((row) => {
    const index = Number(row.dataset.change);
    const list = rows.get(index);
    if (list) list.push(row);
    else rows.set(index, [row]);
  });
  return rows;
}

/**
 * Previous/next change navigation over a Diff body. Each stop is one run of
 * added/removed lines. Navigation continues from the viewport unless the
 * viewport is still exactly where the last jump left it, so manual scrolling
 * always wins and clamped jumps near the end still advance one stop at a time.
 */
export function useDiffChangeNavigation(
  bodyRef: RefObject<HTMLDivElement | null>,
  segments: number[][],
  enabled: boolean,
) {
  const total = enabled ? segments.length : 0;
  const [index, setIndex] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const jump = useRef<{ index: number; scrollTop: number } | null>(null);
  const flashed = useRef<HTMLElement[]>([]);
  const flashTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);

  const measure = () => {
    const body = bodyRef.current;
    if (!body || !total) return null;
    const rows = segmentRows(body);
    const origin = body.getBoundingClientRect().top - body.scrollTop;
    const tops = Array.from({ length: total }, (_, segment) => {
      const first = rows.get(segment)?.[0];
      return first ? first.getBoundingClientRect().top - origin : Number.POSITIVE_INFINITY;
    });
    // Jumps place a change one third down the viewport; that line is the reading position.
    return { body, rows, tops, anchor: body.scrollTop + body.clientHeight / 3 };
  };
  const tracked = (body: HTMLElement) =>
    jump.current && Math.abs(body.scrollTop - jump.current.scrollTop) < 1
      ? jump.current.index
      : null;
  const viewportIndex = () => {
    const state = measure();
    if (!state) return -1;
    const fromJump = tracked(state.body);
    if (fromJump !== null) return fromJump;
    if (state.body.scrollTop <= 0) return -1;
    let current = -1;
    state.tops.forEach((top, segment) => {
      if (top <= state.anchor + 1) current = segment;
    });
    return current;
  };

  const flash = (rows: HTMLElement[]) => {
    window.clearTimeout(flashTimer.current);
    flashed.current.forEach((row) => row.classList.remove('diff-change-flash'));
    // Restart the animation when the same change is revealed twice in a row.
    rows.forEach((row) => void row.offsetWidth);
    rows.forEach((row) => row.classList.add('diff-change-flash'));
    flashed.current = rows;
    flashTimer.current = window.setTimeout(() => {
      rows.forEach((row) => row.classList.remove('diff-change-flash'));
      flashed.current = [];
    }, FLASH_MS);
  };
  const announce = (text: string | null) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(text);
    if (text) noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const reveal = (target: number, highlight = true) => {
    const state = measure();
    if (!state || target < 0 || target >= total) return;
    const { body, rows, tops } = state;
    if (!Number.isFinite(tops[target])) return;
    body.scrollTo({ top: Math.max(0, tops[target] - body.clientHeight / 3) });
    jump.current = { index: target, scrollTop: body.scrollTop };
    setIndex(target);
    if (highlight) flash(rows.get(target) ?? []);
  };

  const go = (step: 1 | -1) => {
    const state = measure();
    if (!state) return;
    const { body, tops, anchor } = state;
    const from = tracked(body);
    let target: number;
    if (from !== null) target = from + step;
    else if (step > 0) target = body.scrollTop <= 0 ? 0 : tops.findIndex((top) => top > anchor + 1);
    else target = tops.findLastIndex((top) => top < anchor - 1);
    if (step > 0 && (target < 0 || target >= total)) {
      target = 0;
      announce(total > 1 ? '已回到第一处改动' : null);
    } else if (step < 0 && target < 0) {
      target = total - 1;
      announce(total > 1 ? '已回到最后一处改动' : null);
    } else {
      announce(null);
    }
    reveal(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!total || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    let step: 1 | -1 | 0 = 0;
    if (event.key === 'F5' && event.altKey) step = event.shiftKey ? -1 : 1;
    else if (event.key === 'F7' && !event.altKey) step = event.shiftKey ? -1 : 1;
    if (!step || (event.target as HTMLElement).closest?.(TEXT_ENTRY)) return;
    event.preventDefault();
    go(step);
  };

  // A refreshed or different patch invalidates the old jump; keep the viewport.
  useLayoutEffect(() => {
    jump.current = null;
    setIndex(viewportIndex());
  }, [segments, total]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !total) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIndex(viewportIndex()));
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      body.removeEventListener('scroll', onScroll);
    };
  }, [bodyRef, segments, total]);

  useEffect(
    () => () => {
      window.clearTimeout(flashTimer.current);
      window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  return {
    total,
    index: Math.min(index, total - 1),
    notice,
    next: () => go(1),
    prev: () => go(-1),
    reveal,
    onKeyDown,
  };
}
