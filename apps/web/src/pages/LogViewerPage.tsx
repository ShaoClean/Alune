import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AluneUIProvider, Button, Input, Select, Tooltip } from '@alune/ui';
import {
  ArrowDownOutlined,
  ClearOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  PauseOutlined,
  CaretRightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { LOG_LEVELS, LOGGING_LIMITS, type LogEntry, type LogLevel } from '@alune/shared';
import { logBridge, loggingApi, loggingError } from '../api/logging';
import '../logs.css';

/** Display cap; older lines drop off the top. Files keep everything. */
export const MAX_VISIBLE_ENTRIES = 5000;
const FOLLOW_THRESHOLD = 24;

type Row = LogEntry & { id: number };
type Connection = 'connecting' | 'live' | 'offline';

let nextId = 1;
const withId = (entry: LogEntry): Row => ({ ...entry, id: nextId++ });
const keyOf = (entry: LogEntry) => `${entry.time}\u0000${entry.source}\u0000${entry.message}`;

function cap(rows: Row[]) {
  return rows.length > MAX_VISIBLE_ENTRIES ? rows.slice(rows.length - MAX_VISIBLE_ENTRIES) : rows;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

function inlineContext(context: LogEntry['context']) {
  if (!context) return '';
  return Object.entries(context)
    .filter(([key]) => key !== 'error' && key !== 'stack')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
}

function errorSummary(context: LogEntry['context']) {
  const error = context?.error as { message?: string } | string | undefined;
  if (!error) return '';
  return typeof error === 'string' ? error : error.message || '';
}

export function formatLine(entry: LogEntry) {
  const details = [inlineContext(entry.context), errorSummary(entry.context)]
    .filter(Boolean)
    .join(' ');
  return `${entry.time} ${entry.level.padEnd(5)} [${entry.source}] ${entry.message}${details ? `  ${details}` : ''}`;
}

const LogLine = memo(function LogLine({
  entry,
  expanded,
  onToggle,
}: {
  entry: Row;
  expanded: boolean;
  onToggle: (id: number) => void;
}) {
  const context = inlineContext(entry.context);
  const error = errorSummary(entry.context);
  const expandable = Boolean(entry.context);
  return (
    <div
      className={`log-line log-line--${entry.level.toLowerCase()}${expanded ? ' log-line--expanded' : ''}`}
      role="listitem"
    >
      <button
        type="button"
        className="log-line__toggle"
        aria-expanded={expandable ? expanded : undefined}
        aria-label={expandable ? (expanded ? '收起详情' : '展开详情') : undefined}
        disabled={!expandable}
        tabIndex={expandable ? 0 : -1}
        onClick={() => onToggle(entry.id)}
      >
        {expandable ? (expanded ? '▾' : '▸') : ''}
      </button>
      <time className="log-line__time" dateTime={entry.time} title={entry.time}>
        {formatTime(entry.time)}
      </time>
      <span className="log-line__level">{entry.level}</span>
      <span className="log-line__source">{entry.source}</span>
      <span className="log-line__message">
        {entry.message}
        {context && <span className="log-line__context"> {context}</span>}
        {error && <span className="log-line__error"> {error}</span>}
      </span>
      {expanded && entry.context && (
        <pre className="log-line__details">{JSON.stringify(entry.context, null, 2)}</pre>
      )}
    </div>
  );
});

export function LogViewerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS]);
  const [source, setSource] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [queued, setQueued] = useState(0);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const pausedRef = useRef(false);
  const queue = useRef<Row[]>([]);
  const followingRef = useRef(true);

  const append = useCallback((incoming: Row[]) => {
    if (!incoming.length) return;
    if (pausedRef.current) {
      queue.current = cap([...queue.current, ...incoming]);
      setQueued(queue.current.length);
      return;
    }
    setRows((current) => cap([...current, ...incoming]));
    if (!followingRef.current) setUnseen((count) => count + incoming.length);
  }, []);

  useEffect(() => {
    let disposed = false;
    // Stream entries that arrive before history is loaded are held, then merged
    // without duplicating lines already present in the history response.
    let pending: Row[] | null = [];
    const socket = io({ transports: ['websocket'] });
    const subscribe = () => {
      setConnection('live');
      socket.emit('logs:subscribe');
    };
    socket.on('connect', subscribe);
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));
    socket.on('log:entries', (entries: LogEntry[]) => {
      const mapped = entries.map(withId);
      if (pending) pending.push(...mapped);
      else append(mapped);
    });
    loggingApi
      .recent(LOGGING_LIMITS.history)
      .then((history) => {
        if (disposed) return;
        const seen = new Set(history.slice(-500).map(keyOf));
        const live = (pending || []).filter((entry) => !seen.has(keyOf(entry)));
        pending = null;
        setRows(cap([...history.map(withId), ...live]));
      })
      .catch((error) => {
        if (disposed) return;
        setLoadError(loggingError(error, '无法读取历史日志，仅显示新产生的日志。'));
        const live = pending || [];
        pending = null;
        setRows(cap(live));
      });
    return () => {
      disposed = true;
      socket.disconnect();
    };
  }, [append]);

  const sources = useMemo(
    () => [...new Set(rows.map((row) => row.source))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const counts = useMemo(() => {
    const result: Record<LogLevel, number> = { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 };
    for (const row of rows) result[row.level]++;
    return result;
  }, [rows]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        levels.includes(row.level) &&
        (!source || row.source === source) &&
        (!needle ||
          row.message.toLowerCase().includes(needle) ||
          row.source.toLowerCase().includes(needle) ||
          (row.context && JSON.stringify(row.context).toLowerCase().includes(needle))),
    );
  }, [rows, levels, source, query]);

  const scrollToBottom = useCallback(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
    followingRef.current = true;
    setFollowing(true);
    setUnseen(0);
  }, []);

  useLayoutEffect(() => {
    if (followingRef.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const element = viewport.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_THRESHOLD;
    if (atBottom !== followingRef.current) {
      followingRef.current = atBottom;
      setFollowing(atBottom);
      if (atBottom) setUnseen(0);
    }
  };

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (!next) {
      const held = queue.current;
      queue.current = [];
      setQueued(0);
      append(held);
    }
  };

  const clear = () => {
    setRows([]);
    setExpanded(new Set());
    setUnseen(0);
    queue.current = [];
    setQueued(0);
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2400);
  };

  const copy = async () => {
    const selection = window.getSelection()?.toString() || '';
    const text = selection || visible.map(formatLine).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flash(selection ? '已复制所选内容' : `已复制 ${visible.length} 条日志`);
    } catch {
      flash('复制失败，请选中文本后使用系统快捷键复制');
    }
  };

  const openDirectory = async () => {
    try {
      await logBridge()?.openDirectory();
    } catch (error) {
      flash(error instanceof Error ? error.message : '无法打开日志目录');
    }
  };

  const toggleLevel = (level: LogLevel) =>
    setLevels((current) =>
      current.includes(level) ? current.filter((item) => item !== level) : [...current, level],
    );

  const toggleExpanded = useCallback(
    (id: number) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="log-viewer" aria-label="实时日志">
      <header className="log-viewer__toolbar">
        <div className="log-viewer__title">
          <h1>日志</h1>
          <span
            className={`log-viewer__status log-viewer__status--${paused ? 'paused' : connection}`}
            role="status"
          >
            {paused
              ? `已暂停${queued ? ` · ${queued} 条待显示` : ''}`
              : connection === 'live'
                ? '实时'
                : connection === 'connecting'
                  ? '正在连接…'
                  : '已断开，正在重连…'}
          </span>
        </div>
        <div className="log-viewer__levels" role="group" aria-label="按等级筛选">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`log-level-chip log-level-chip--${level.toLowerCase()}`}
              aria-pressed={levels.includes(level)}
              onClick={() => toggleLevel(level)}
            >
              {level}
              <span className="log-level-chip__count">{counts[level]}</span>
            </button>
          ))}
        </div>
        <Select
          className="log-viewer__source"
          size="small"
          allowClear
          placeholder="全部来源"
          aria-label="按来源筛选"
          value={source}
          onChange={(value) => setSource(value ?? null)}
          options={sources.map((value) => ({ value, label: value }))}
          popupMatchSelectWidth={false}
        />
        <Input
          ref={(input) => {
            search.current = input?.input ?? null;
          }}
          className="log-viewer__search"
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索消息、来源或上下文"
          aria-label="关键字搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="log-viewer__actions">
          <Tooltip title={paused ? '继续接收' : '暂停显示新日志'}>
            <Button
              size="small"
              type="text"
              icon={paused ? <CaretRightOutlined /> : <PauseOutlined />}
              aria-label={paused ? '继续' : '暂停'}
              onClick={togglePause}
            />
          </Tooltip>
          <Tooltip title="清屏（只清除显示，不删除日志文件）">
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              aria-label="清屏"
              onClick={clear}
            />
          </Tooltip>
          <Tooltip title="复制所选内容；未选择时复制当前筛选结果">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              aria-label="复制"
              onClick={() => void copy()}
            />
          </Tooltip>
          {logBridge() && (
            <Tooltip title="打开日志目录">
              <Button
                size="small"
                type="text"
                icon={<FolderOpenOutlined />}
                aria-label="打开日志目录"
                onClick={() => void openDirectory()}
              />
            </Tooltip>
          )}
        </div>
      </header>
      {loadError && (
        <div className="log-viewer__banner" role="alert">
          {loadError}
        </div>
      )}
      <div
        ref={viewport}
        className="log-viewer__viewport"
        onScroll={onScroll}
        role="list"
        aria-label="日志内容"
        aria-live="off"
        tabIndex={0}
      >
        {visible.length ? (
          visible.map((row) => (
            <LogLine
              key={row.id}
              entry={row}
              expanded={expanded.has(row.id)}
              onToggle={toggleExpanded}
            />
          ))
        ) : (
          <div className="log-viewer__empty">
            {rows.length ? '没有符合筛选条件的日志。' : '暂无日志，新日志会实时显示在这里。'}
          </div>
        )}
      </div>
      <footer className="log-viewer__footer">
        <span>
          显示 {visible.length} / {rows.length} 条
          {rows.length >= MAX_VISIBLE_ENTRIES ? `（最多保留最近 ${MAX_VISIBLE_ENTRIES} 条）` : ''}
        </span>
        {notice && <span role="status">{notice}</span>}
      </footer>
      {!following && (
        <Button
          className="log-viewer__bottom"
          size="small"
          type="primary"
          icon={<ArrowDownOutlined />}
          onClick={scrollToBottom}
        >
          回到底部{unseen ? ` · ${unseen} 条新日志` : ''}
        </Button>
      )}
    </main>
  );
}

export function LogViewerRoot() {
  return (
    <AluneUIProvider theme="dark">
      <LogViewerPage />
    </AluneUIProvider>
  );
}
