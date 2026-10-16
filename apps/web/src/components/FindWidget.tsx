import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined } from '@ant-design/icons';
import { FIND_MATCH_LIMIT } from './find-in-content';
import type { FindOptions } from './find-in-content';
import { useFindInContent } from './useFindInContent';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const ALT = isMac ? '⌥⌘' : 'Alt+';

const OPTIONS = [
  { key: 'caseSensitive', code: 'KeyC', label: '大小写匹配', glyph: 'Aa' },
  { key: 'wholeWord', code: 'KeyW', label: '全字匹配', glyph: <u>ab</u> },
  { key: 'regex', code: 'KeyR', label: '使用正则表达式', glyph: '.*' },
] as const;

// Remembered for the session across every Diff and file preview, like VSCode.
let sessionQuery = '';
let sessionOptions: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };

const isEditable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

// Hover is enough to target a scope, unless an input elsewhere (terminal,
// commit message, file filter) owns the keyboard.
function scopeActive(scope: HTMLElement | null, input?: HTMLElement | null): scope is HTMLElement {
  if (!scope) return false;
  const active = document.activeElement;
  const focused = !!active && scope.contains(active);
  if (isEditable(active) && !(focused && active === input)) return false;
  return focused || scope.matches(':hover');
}

const optionShortcut = (event: KeyboardEvent | ReactKeyboardEvent) =>
  event.altKey &&
  !event.shiftKey &&
  (isMac ? event.metaKey && !event.ctrlKey : !event.metaKey && !event.ctrlKey) &&
  OPTIONS.find((option) => option.code === event.code);

interface OpenRequest {
  id: number;
  // `null` keeps the current search term when the widget is already open.
  query: string | null;
}

function FindWidget({
  scopeRef,
  request,
  onClose,
  inputRef,
}: {
  scopeRef: RefObject<HTMLElement | null>;
  request: OpenRequest;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState(request.query ?? sessionQuery);
  const [focusRequest, setFocusRequest] = useState(request.id);
  const [options, setOptions] = useState(sessionOptions);
  const { state, next, previous } = useFindInContent(scopeRef, true, query, options);
  const errorId = useId();
  const navigation = useRef({ next, previous });
  navigation.current = { next, previous };

  useEffect(() => {
    sessionQuery = query;
  }, [query]);
  useEffect(() => {
    if (request.query !== null) setQuery(request.query);
    setFocusRequest(request.id);
  }, [request]);
  // Select after the new term renders, so reopening always selects all of it.
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest, inputRef]);
  const toggle = (key: keyof FindOptions) =>
    setOptions((value) => (sessionOptions = { ...value, [key]: !value[key] }));

  // F3 and the option shortcuts also work while the content keeps focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const scope = scopeRef.current;
      if (!scopeActive(scope, inputRef.current)) return;
      const option = optionShortcut(event);
      if (event.key === 'F3') navigation.current[event.shiftKey ? 'previous' : 'next']();
      else if (option && scope.contains(document.activeElement)) toggle(option.key);
      else if (event.key === 'Escape' && scope.contains(document.activeElement)) onClose();
      else return;
      // Stops Escape from also leaving fullscreen Diff.
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [scopeRef, inputRef, onClose]);

  const empty = !!query && !state.error && state.total === 0;
  const status = !state.supported
    ? '当前内容不支持搜索'
    : !query
      ? '无结果'
      : state.total === 0
        ? '无结果'
        : `第 ${state.current + 1} 项，共 ${state.truncated ? `${FIND_MATCH_LIMIT}+` : state.total} 项`;

  return (
    <div className="find-widget" role="search" aria-label="在内容中查找" data-find-widget>
      <div className="find-widget__row">
        <div
          className={`find-widget__field${state.error || (empty && state.supported) ? ' find-widget__field--error' : ''}`}
        >
          <input
            ref={inputRef}
            className="find-widget__input"
            aria-label="查找"
            placeholder="查找"
            spellCheck={false}
            value={query}
            aria-invalid={Boolean(state.error) || undefined}
            aria-describedby={state.error ? errorId : undefined}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (event.shiftKey) previous();
              else next();
            }}
          />
          {OPTIONS.map(({ key, label, glyph, code }) => (
            <button
              key={key}
              type="button"
              className="find-widget__option"
              aria-label={label}
              aria-pressed={options[key]}
              title={`${label} (${ALT}${code.slice(3)})`}
              onClick={() => toggle(key)}
            >
              {glyph}
            </button>
          ))}
        </div>
        <span className="find-widget__count" role="status" aria-live="polite">
          {status}
        </span>
        <button
          type="button"
          className="find-widget__button"
          aria-label="上一个匹配项"
          title="上一个匹配项 (Shift+Enter)"
          disabled={!state.total}
          onClick={previous}
        >
          <ArrowUpOutlined />
        </button>
        <button
          type="button"
          className="find-widget__button"
          aria-label="下一个匹配项"
          title="下一个匹配项 (Enter)"
          disabled={!state.total}
          onClick={next}
        >
          <ArrowDownOutlined />
        </button>
        <button
          type="button"
          className="find-widget__button"
          aria-label="关闭查找"
          title="关闭 (Escape)"
          onClick={onClose}
        >
          <CloseOutlined />
        </button>
      </div>
      {state.error && (
        <div className="find-widget__error" id={errorId} role="alert">
          正则表达式无效：{state.error}
        </div>
      )}
    </div>
  );
}

// Wraps a Diff or file preview. Cmd/Ctrl+F opens the widget when the pointer or
// focus is inside, unless another input (terminal, commit message, filters) has focus.
export function FindScope({
  className,
  children,
  focusTarget,
}: {
  className?: string;
  children: ReactNode;
  focusTarget?: RefObject<HTMLElement | null>;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [request, setRequest] = useState<OpenRequest | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const scope = scopeRef.current;
      if (
        event.key.toLowerCase() !== 'f' ||
        event.altKey ||
        event.shiftKey ||
        !(isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) ||
        !scopeActive(scope, inputRef.current)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const selection = window.getSelection();
      const selected =
        selection?.anchorNode && !selection.isCollapsed && scope.contains(selection.anchorNode)
          ? selection.toString()
          : '';
      const query = selected && !selected.includes('\n') ? selected : null;
      setRequest((value) => ({ id: (value?.id ?? 0) + 1, query }));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const close = useCallback(() => {
    setRequest(null);
    (focusTarget?.current ?? scopeRef.current?.querySelector<HTMLElement>('[tabindex]'))?.focus({
      preventScroll: true,
    });
  }, [focusTarget]);

  return (
    <div className={`find-scope${className ? ` ${className}` : ''}`} ref={scopeRef}>
      {children}
      {request && (
        <FindWidget scopeRef={scopeRef} request={request} onClose={close} inputRef={inputRef} />
      )}
    </div>
  );
}
