import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { compileFindPattern, findMatches, nearestMatchIndex } from './find-in-content';
import type { FindMatch, FindOptions } from './find-in-content';

// Hosts mark searchable text with `data-find-unit`; line numbers, hunk headers
// and actions stay outside the units or carry `data-find-ignore`.
export const FIND_UNIT_SELECTOR = '[data-find-unit]';
const FIND_IGNORE_SELECTOR = '[data-find-ignore]';
export const FIND_WIDGET_SELECTOR = '[data-find-widget]';
const MATCH_HIGHLIGHT = 'alune-find-match';
const CURRENT_HIGHLIGHT = 'alune-find-current';
const SEARCH_DELAY = 120;

interface TextUnit {
  text: string;
  nodes: Text[];
  offsets: number[];
}

function readUnit(element: Element): TextUnit {
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(FIND_IGNORE_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push(node);
    offsets.push(text.length);
    text += node.data;
  }
  return { text, nodes, offsets };
}

function locate(unit: TextUnit, offset: number, end: boolean) {
  let low = 0;
  let high = unit.offsets.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    // A match ending exactly on a node boundary stays in the earlier node.
    if (end ? unit.offsets[middle] < offset : unit.offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { node: unit.nodes[low], offset: offset - unit.offsets[low] };
}

function toRange(unit: TextUnit, match: FindMatch) {
  const start = locate(unit, match.start, false);
  const end = locate(unit, match.end, true);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

const inWidget = (node: Node) =>
  Boolean((node instanceof Element ? node : node.parentElement)?.closest(FIND_WIDGET_SELECTOR));

const highlightsSupported = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

// The highlight registry is global; only the most recently opened widget paints.
let highlightOwner: symbol | null = null;

function paint(owner: symbol, ranges: Range[], current: Range | undefined) {
  if (!highlightsSupported()) return;
  highlightOwner = owner;
  CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...ranges));
  const active = current ? new Highlight(current) : new Highlight();
  // Paint the current match above the others wherever they overlap.
  active.priority = 1;
  CSS.highlights.set(CURRENT_HIGHLIGHT, active);
}

function clearPaint(owner: symbol) {
  if (!highlightsSupported() || highlightOwner !== owner) return;
  highlightOwner = null;
  CSS.highlights.delete(MATCH_HIGHLIGHT);
  CSS.highlights.delete(CURRENT_HIGHLIGHT);
}

function scrollable(element: HTMLElement, axis: 'x' | 'y') {
  const overflow = getComputedStyle(element)[axis === 'y' ? 'overflowY' : 'overflowX'];
  return (
    /(auto|scroll|overlay)/.test(overflow) &&
    (axis === 'y'
      ? element.scrollHeight > element.clientHeight
      : element.scrollWidth > element.clientWidth)
  );
}

// Center the match in its nearest scroll containers when it is out of view,
// horizontally then vertically, without scrolling anything outside the scope.
// A match under the floating widget counts as hidden.
function reveal(range: Range, scope: HTMLElement) {
  for (const axis of ['x', 'y'] as const) {
    let element = range.startContainer.parentElement;
    while (element && scope.contains(element) && !scrollable(element, axis))
      element = element.parentElement;
    if (!element || !scope.contains(element)) continue;
    const box = range.getBoundingClientRect();
    const view = element.getBoundingClientRect();
    if (axis === 'x') {
      // Sticky gutters cover the left edge, so keep a margin before the match.
      if (box.left >= view.left + 80 && box.right <= view.left + element.clientWidth) continue;
      element.scrollLeft += box.left + box.width / 2 - (view.left + element.clientWidth / 2);
    } else {
      const widget = scope.querySelector(FIND_WIDGET_SELECTOR)?.getBoundingClientRect();
      const covered =
        !!widget &&
        box.top < widget.bottom &&
        box.bottom > widget.top &&
        box.right > widget.left &&
        box.left < widget.right;
      if (!covered && box.top >= view.top && box.bottom <= view.top + element.clientHeight)
        continue;
      element.scrollTop += box.top + box.height / 2 - (view.top + element.clientHeight / 2);
    }
  }
}

export interface FindState {
  total: number;
  truncated: boolean;
  current: number;
  error?: string;
  supported: boolean;
}

export function useFindInContent(
  scopeRef: RefObject<HTMLElement | null>,
  open: boolean,
  query: string,
  options: FindOptions,
) {
  const owner = useMemo(() => Symbol('find'), []);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<FindState>({
    total: 0,
    truncated: false,
    current: -1,
    supported: true,
  });
  const results = useRef<{ matches: FindMatch[]; units: TextUnit[]; ranges: Range[] }>({
    matches: [],
    units: [],
    ranges: [],
  });
  const position = useRef<Pick<FindMatch, 'unit' | 'start'> | null>(null);
  const lastSearch = useRef('');

  // Re-run the search when diffs refresh, views switch or another file opens.
  useEffect(() => {
    const scope = scopeRef.current;
    if (!open || !scope) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver((records) => {
      if (records.every((record) => inWidget(record.target))) return;
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((value) => value + 1), SEARCH_DELAY);
    });
    observer.observe(scope, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [open, scopeRef]);

  const select = useCallback(
    (index: number, scroll: boolean) => {
      const { matches, ranges } = results.current;
      const match = matches[index];
      position.current = match ? { unit: match.unit, start: match.start } : null;
      paint(owner, ranges, ranges[index]);
      setState((value) => ({ ...value, current: index }));
      const scope = scopeRef.current;
      if (scroll && scope && ranges[index]) reveal(ranges[index], scope);
    },
    [owner, scopeRef],
  );

  useEffect(() => {
    if (!open) {
      clearPaint(owner);
      position.current = null;
      lastSearch.current = '';
      results.current = { matches: [], units: [], ranges: [] };
      return;
    }
    const searchKey = JSON.stringify([query, options]);
    const searchChanged = searchKey !== lastSearch.current;
    const run = () => {
      const scope = scopeRef.current;
      if (!scope) return;
      const elements = [...scope.querySelectorAll(FIND_UNIT_SELECTOR)].filter(
        (element) => !inWidget(element),
      );
      const pattern = compileFindPattern(query, options);
      if (pattern && 'error' in pattern) {
        // Keep the previous results visible while the expression is incomplete.
        setState((value) => ({ ...value, error: pattern.error, supported: elements.length > 0 }));
        return;
      }
      lastSearch.current = searchKey;
      if (!pattern || !elements.length) {
        results.current = { matches: [], units: [], ranges: [] };
        paint(owner, [], undefined);
        setState({ total: 0, truncated: false, current: -1, supported: elements.length > 0 });
        return;
      }
      const units = elements.map(readUnit);
      const { matches, truncated } = findMatches(
        units.map((unit) => unit.text),
        pattern.regex,
        options.wholeWord,
      );
      const ranges = matches.map((match) => toRange(units[match.unit], match));
      results.current = { matches, units, ranges };
      setState({ total: matches.length, truncated, current: -1, supported: true });
      // Typing jumps to the first match after the previous one, like VSCode.
      select(nearestMatchIndex(matches, position.current), searchChanged);
    };
    if (!searchChanged) {
      run();
      return;
    }
    const timer = setTimeout(run, query ? SEARCH_DELAY : 0);
    return () => clearTimeout(timer);
  }, [open, query, options, version, owner, scopeRef, select]);

  useEffect(() => () => clearPaint(owner), [owner]);

  const step = useCallback(
    (delta: 1 | -1) => {
      const total = results.current.matches.length;
      if (!total) return;
      select(state.current < 0 ? 0 : (state.current + delta + total) % total, true);
    },
    [select, state.current],
  );

  return { state, next: () => step(1), previous: () => step(-1) };
}
