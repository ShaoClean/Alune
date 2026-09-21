import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { GraphCommit, CommitReference } from '@alune/shared';
import { Button } from 'antd';
import { useRepositoryStore } from '../stores/repositoryStore';
import { EmptyState, formatRelativeDate } from './ui';
import { appendGraph, emptyGraph, GRAPH_LANE_WIDTH, GRAPH_ROW_HEIGHT } from './commit-graph';
import type { GraphLayout, GraphRow } from './commit-graph';
import '../history.css';

interface Props {
  repoId: string;
  onSelectCommit?: (commit: GraphCommit) => void;
  selectedHash?: string | null;
  visible?: boolean;
}
const colors = ['#2563eb', '#8b5cf6', '#0d9488', '#d97706', '#db2777', '#0891b2'];
const color = (index: number) => colors[index % colors.length];
const x = (lane: number) => 20 + lane * GRAPH_LANE_WIDTH;

function GraphCell({ row, width, merge }: { row: GraphRow; width: number; merge: boolean }) {
  return (
    <svg width={width} height={GRAPH_ROW_HEIGHT} aria-hidden="true" className="history-graph">
      {row.edges.map((edge, i) => {
        const top = edge.half === 'bottom' ? GRAPH_ROW_HEIGHT / 2 : 0;
        const bottom = edge.half === 'top' ? GRAPH_ROW_HEIGHT / 2 : GRAPH_ROW_HEIGHT;
        const from = x(edge.from),
          to = x(edge.to),
          mid = (top + bottom) / 2;
        const path =
          'M ' +
          from +
          ' ' +
          top +
          ' C ' +
          from +
          ' ' +
          mid +
          ', ' +
          to +
          ' ' +
          mid +
          ', ' +
          to +
          ' ' +
          bottom;
        return <path key={i} d={path} fill="none" stroke={color(edge.color)} strokeWidth="1.8" />;
      })}
      <circle
        cx={x(row.lane)}
        cy={GRAPH_ROW_HEIGHT / 2}
        r={merge ? 5 : 4}
        fill={merge ? 'var(--surface)' : color(row.color)}
        stroke={color(row.color)}
        strokeWidth="2"
      />
      {merge && (
        <circle cx={x(row.lane)} cy={GRAPH_ROW_HEIGHT / 2} r="1.8" fill={color(row.color)} />
      )}
    </svg>
  );
}

export function HistoryReference({ reference }: { reference: CommitReference }) {
  return (
    <span className={'history-ref history-ref--' + reference.kind} title={reference.fullName}>
      <span aria-hidden="true">
        {reference.kind === 'tag' ? '◇' : reference.kind === 'remote' ? '↗' : '⑂'}
      </span>
      <span className="history-ref__name">
        {reference.current && reference.kind === 'local' ? 'HEAD → ' : ''}
        {reference.name}
      </span>
    </span>
  );
}

export function HistoryView({ repoId, onSelectCommit, selectedHash, visible = true }: Props) {
  const {
    log,
    logLoading,
    logLoadingMore,
    logHasMore,
    logRevision,
    logGeneration,
    logError,
    logErrorMode,
    logChanged,
    logShallow,
    fetchLog,
  } = useRepositoryStore();
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const graphCache = useRef<{ generation: number; graph: GraphLayout }>({
    generation: -1,
    graph: emptyGraph(),
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [focused, setFocused] = useState(0);
  const graph = useMemo(() => {
    const cached = graphCache.current;
    const previous =
      cached.generation === logGeneration && cached.graph.rows.length <= log.length
        ? cached.graph
        : emptyGraph();
    const next = appendGraph(previous, log.slice(previous.rows.length));
    graphCache.current = { generation: logGeneration, graph: next };
    return next;
  }, [log, logGeneration]);

  useEffect(() => {
    if (!logRevision && !useRepositoryStore.getState().logLoading) void fetchLog(repoId);
  }, [repoId, fetchLog]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [log.length > 0]);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    scrollTopRef.current = 0;
    setScrollTop(0);
    setFocused(0);
  }, [logGeneration]);
  useLayoutEffect(() => {
    if (!visible || !viewport.current || viewport.current.scrollTop === scrollTopRef.current) return;
    viewport.current.scrollTop = scrollTopRef.current;
  }, [visible, height, logGeneration]);

  const start = Math.max(0, Math.floor((scrollTop - GRAPH_ROW_HEIGHT) / GRAPH_ROW_HEIGHT) - 12);
  const end = Math.min(log.length, start + Math.ceil(height / GRAPH_ROW_HEIGHT) + 25);
  const graphWidth = Math.max(72, graph.width * GRAPH_LANE_WIDTH + 24);
  const updateScrollTop = (value: number) => {
    scrollTopRef.current = value;
    setScrollTop(value);
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const handleScroll = () => updateScrollTop(element.scrollTop);
    element.addEventListener('scroll', handleScroll);
    return () => element.removeEventListener('scroll', handleScroll);
  }, []);
  useEffect(() => {
    if (!logHasMore || logLoading || logLoadingMore || logChanged || logError) return;
    const total = log.length * GRAPH_ROW_HEIGHT;
    if (total - (scrollTop + height) <= GRAPH_ROW_HEIGHT * 4) void fetchLog(repoId, 'more');
  }, [
    scrollTop,
    height,
    log.length,
    logHasMore,
    logLoading,
    logLoadingMore,
    logChanged,
    logError,
    repoId,
    fetchLog,
  ]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!log.length) return;
    let index = focused;
    if (event.key === 'ArrowDown') index++;
    else if (event.key === 'ArrowUp') index--;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = log.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectCommit?.(log[focused]);
      return;
    } else return;
    event.preventDefault();
    index = Math.max(0, Math.min(log.length - 1, index));
    setFocused(index);
    const element = viewport.current!;
    const top = index * GRAPH_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + GRAPH_ROW_HEIGHT * 2 > element.scrollTop + element.clientHeight)
      element.scrollTop = top + GRAPH_ROW_HEIGHT * 2 - element.clientHeight;
  };

  return (
    <section className="workspace-panel history-panel" aria-label="所有分支提交历史">
      {logError && (
        <div className="history-notice history-notice--error" role="alert">
          <span>{logError}</span>
          <Button
            size="small"
            onClick={() => void fetchLog(repoId, logChanged ? 'refresh' : logErrorMode)}
          >
            {logChanged ? '刷新历史' : '重试'}
          </Button>
        </div>
      )}
      {logShallow && (
        <div className="history-notice" role="status">
          浅克隆仓库：仅显示本地已获取的历史。
        </div>
      )}
      {!log.length ? (
        logLoading ? (
          <div className="history-empty" role="status">
            正在读取所有分支的提交…
          </div>
        ) : (
          !logError && <EmptyState title="暂无提交" description="此仓库没有可显示的历史记录。" />
        )
      ) : (
        <div
          className="history-viewport"
          ref={viewport}
          onScroll={(event) => updateScrollTop(event.currentTarget.scrollTop)}
        >
          <div
            className="history-table"
            role="grid"
            aria-label="提交图"
            aria-rowcount={log.length + 1}
            aria-colcount={6}
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-activedescendant={
              focused >= start && focused < end ? 'commit-' + log[focused]?.hash : undefined
            }
            style={{ '--graph-width': graphWidth + 'px' } as CSSProperties}
          >
            <div className="history-columns history-table__header" role="row" aria-rowindex={1}>
              {['提交图', '提交信息', '分支 / 标签', '作者', '时间', '提交'].map((label, i) => (
                <span role="columnheader" key={label} aria-colindex={i + 1}>
                  {label}
                </span>
              ))}
            </div>
            <div style={{ height: start * GRAPH_ROW_HEIGHT }} role="presentation" />
            {log.slice(start, end).map((commit, offset) => {
              const index = start + offset;
              return (
                <div
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={selectedHash === commit.hash}
                  id={'commit-' + commit.hash}
                  key={commit.hash}
                  data-hash={commit.hash}
                  className={
                    'history-columns history-row' +
                    (selectedHash === commit.hash ? ' history-row--selected' : '') +
                    (focused === index ? ' history-row--focused' : '')
                  }
                  onClick={() => {
                    setFocused(index);
                    onSelectCommit?.(commit);
                  }}
                >
                  <span role="gridcell">
                    <GraphCell
                      row={graph.rows[index]}
                      width={graphWidth}
                      merge={commit.parents.length > 1}
                    />
                  </span>
                  <span role="gridcell" className="history-row__message" title={commit.message}>
                    {commit.message || '无提交信息'}
                  </span>
                  <span
                    role="gridcell"
                    className="history-row__refs"
                    title={commit.references.map((ref) => ref.fullName).join('\n')}
                  >
                    {commit.references.slice(0, 2).map((reference) => (
                      <HistoryReference key={reference.fullName} reference={reference} />
                    ))}
                    {commit.references.length > 2 && (
                      <span className="history-ref-count">+{commit.references.length - 2}</span>
                    )}
                  </span>
                  <span
                    role="gridcell"
                    className="history-row__author"
                    title={commit.author + ' <' + commit.email + '>'}
                  >
                    {commit.author}
                  </span>
                  <span
                    role="gridcell"
                    className="history-row__date"
                    title={new Date(commit.date).toLocaleString('zh-CN')}
                  >
                    {formatRelativeDate(commit.date)}
                  </span>
                  <code role="gridcell" className="history-row__hash">
                    {commit.shortHash}
                  </code>
                </div>
              );
            })}
            <div style={{ height: (log.length - end) * GRAPH_ROW_HEIGHT }} role="presentation" />
          </div>
        </div>
      )}
    </section>
  );
}
