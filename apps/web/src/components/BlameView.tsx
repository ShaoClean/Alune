import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BlameLine, BlameOptions, BlameResult } from '@alune/shared';
import { Button, ErrorState, FeedbackNotice, Popover, Spin } from '@alune/ui';
import { CodeView } from './CodeView';
import { fileLanguage } from './file-language';
import { repositoryApi } from '../api';
import { errorMessage } from './files-tree';

type Ready = Extract<BlameResult, { kind: 'ready' }>;

export function blameRelativeDate(date: string, now = Date.now()): string {
  const seconds = (new Date(date).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return '—';
  if (Math.abs(seconds) < 60) return '刚刚';
  const units = [
    ['year', 365 * 86400],
    ['month', 30 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const;
  const [unit, duration] = units.find(([, duration]) => Math.abs(seconds) >= duration)!;
  return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'always' }).format(
    Math.trunc(seconds / duration),
    unit,
  );
}

export function blameGroups(lines: BlameLine[]) {
  const groups: BlameLine[][] = [];
  for (const line of lines) {
    const group = groups.at(-1);
    if (group && group[0].hash === line.hash) group.push(line);
    else groups.push([line]);
  }
  return groups;
}

function BlameBlock({
  repoId,
  lines,
  data,
  onPrevious,
  onSelectCommit,
}: {
  repoId: string;
  lines: BlameLine[];
  data: Ready;
  onPrevious: (line: number) => void;
  onSelectCommit?: (hash: string) => void;
}) {
  const first = lines[0];
  const commit = data.commits[first.hash];
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['blame-commit', repoId, first.hash],
    queryFn: ({ signal }) => repositoryApi.blameCommit(repoId, first.hash, signal),
    enabled: open && !first.uncommitted,
    staleTime: Infinity,
    retry: false,
  });
  const message = detail.data?.body ?? commit.summary;
  const newline = message.indexOf('\n');
  const subject = newline < 0 ? message : message.slice(0, newline);
  const body = newline < 0 ? '' : message.slice(newline + 1).trim();
  const notes = [
    lines.every((line) => !line.previous) && '此版本没有可追溯的父版本。',
    lines.some((line) => line.ignored) && '已越过忽略列表中的提交。',
    lines.some((line) => line.unblamable) && '部分行无法归属到被忽略提交之外的版本。',
  ].filter(Boolean);
  const info = (
    <div className="blame-popover">
      <header className="blame-popover__header">
        <div className="blame-popover__identity">
          <strong>{commit.author}</strong>
          {commit.email && <span>{commit.email}</span>}
        </div>
        {!first.uncommitted && (
          <time dateTime={commit.date} title={new Date(commit.date).toLocaleString('zh-CN')}>
            {blameRelativeDate(commit.date)}
          </time>
        )}
      </header>
      <div className="blame-popover__message">
        <p>{first.uncommitted ? '尚未提交的修改' : subject}</p>
        {body && <pre>{body}</pre>}
        {detail.isFetching && <span className="blame-popover__hint">正在读取完整提交信息…</span>}
        {detail.error && (
          <Button size="small" onClick={() => void detail.refetch()}>
            重试完整提交信息
          </Button>
        )}
      </div>
      {!first.uncommitted && (
        <div className="blame-popover__meta">
          <code title={first.hash}>{first.hash.slice(0, 8)}</code>
          <span>{new Date(commit.date).toLocaleString('zh-CN')}</span>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="blame-popover__notes">
          {notes.map((note) => (
            <li key={note as string}>{note}</li>
          ))}
        </ul>
      )}
      {!first.uncommitted && (
        <footer className="blame-popover__footer">
          <Button size="small" type="link" onClick={() => onSelectCommit?.(first.hash)}>
            在提交历史中查看 →
          </Button>
        </footer>
      )}
    </div>
  );
  return (
    <Popover
      open={open}
      content={info}
      trigger={['hover', 'focus']}
      placement="rightTop"
      onOpenChange={setOpen}
    >
      <div className={'blame-block' + (first.uncommitted ? ' blame-block--uncommitted' : '')}>
        {lines.map((line, index) => (
          <div
            className={'blame-row' + (data.focusLine === line.line ? ' blame-row--focused' : '')}
            key={line.line}
            data-blame-line={line.line}
          >
            <button
              className="blame-row__commit"
              type="button"
              aria-label={`第 ${line.line} 行：${commit.author}，${commit.summary}${first.uncommitted ? '' : '，查看提交'}`}
              onClick={() => {
                if (!first.uncommitted) onSelectCommit?.(first.hash);
              }}
            >
              {index === 0 ? (
                <>
                  <span className="blame-row__author">{commit.author}</span>
                  {!first.uncommitted && <time>{blameRelativeDate(commit.date)}</time>}
                  <span className="blame-row__summary">
                    {first.uncommitted ? '' : commit.summary}
                  </span>
                </>
              ) : (
                <span className="blame-row__continuation" aria-hidden="true">
                  {commit.author} · {commit.summary}
                </span>
              )}
            </button>
            <button
              className="blame-row__previous"
              type="button"
              disabled={!line.previous}
              title={line.previous ? `追溯第 ${line.line} 行到上一版本` : '没有可追溯的父版本'}
              aria-label={`追溯第 ${line.line} 行到上一版本`}
              onClick={() => {
                setOpen(false);
                onPrevious(line.line);
              }}
            >
              ↶
            </button>
          </div>
        ))}
      </div>
    </Popover>
  );
}

export function BlameView({
  repoId,
  path,
  refreshToken,
  contentRevision,
  onSelectCommit,
  onVersionChange,
}: {
  repoId: string;
  path: string;
  refreshToken?: number;
  contentRevision: string;
  onVersionChange: (version: { path: string; lines?: number } | undefined) => void;
  onSelectCommit?: (hash: string) => void;
}) {
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [useIgnoreRevs, setUseIgnoreRevs] = useState(true);
  const [versions, setVersions] = useState<BlameOptions[]>([{ path }]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: BlameResult; error?: string }>();
  const request = versions.at(-1)!;
  const key = JSON.stringify([
    request,
    ignoreWhitespace,
    useIgnoreRevs,
    refreshToken,
    contentRevision,
    attempt,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    repositoryApi
      .blame(repoId, { ...request, ignoreWhitespace, useIgnoreRevs }, controller.signal)
      .then(
        (data) => {
          if (controller.signal.aborted) return;
          setState({ key, data });
        },
        (error) => {
          if (!controller.signal.aborted)
            setState({ key, error: errorMessage(error, '无法读取逐行追溯') });
        },
      );
    return () => controller.abort();
  }, [repoId, key]);
  const data = state?.key === key ? state.data : undefined;
  const failure = state?.key === key ? state.error : undefined;
  useEffect(() => {
    onVersionChange(
      data
        ? { path: data.path, lines: data.kind === 'ready' ? data.lines.length : undefined }
        : undefined,
    );
  }, [data, onVersionChange]);
  const groups = useMemo(() => (data?.kind === 'ready' ? blameGroups(data.lines) : []), [data]);
  // Parent navigation resolves to an immutable revision. Changing whitespace
  // options must re-read that version instead of walking back a second time.
  const changeOptions = (change: () => void) => {
    if (data?.kind === 'ready' && request.previousLine) {
      setVersions((all) => [...all.slice(0, -1), { path: data.path, revision: data.revision }]);
    }
    change();
  };
  return (
    <>
      <div className="blame-toolbar">
        <label>
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(event) => changeOptions(() => setIgnoreWhitespace(event.target.checked))}
          />
          忽略空白变化
        </label>
        <label title="读取仓库工作区中的 .git-blame-ignore-revs">
          <input
            type="checkbox"
            checked={useIgnoreRevs}
            onChange={(event) => changeOptions(() => setUseIgnoreRevs(event.target.checked))}
          />
          使用忽略提交文件
        </label>
        {versions.length > 1 && (
          <>
            <Button size="small" onClick={() => setVersions((all) => all.slice(0, -1))}>
              返回上一视图
            </Button>
            <Button size="small" onClick={() => setVersions([{ path }])}>
              返回工作区
            </Button>
          </>
        )}
        {data?.revision && (
          <span title={data.revision}>
            {data.path} · {data.revision.slice(0, 8)}
          </span>
        )}
        {data?.kind === 'ready' && data.ignoreRevsApplied && <span>忽略提交文件已生效</span>}
        {data?.kind === 'ready' && data.notice && <span role="status">{data.notice}</span>}
      </div>
      {!data && !failure && (
        <div className="files-preview__loading" role="status">
          <Spin size="small" />
          正在读取逐行追溯…
        </div>
      )}
      <FeedbackNotice
        source="file-blame"
        context={path}
        title={failure}
        actionLabel="重试"
        onAction={() => setAttempt((value) => value + 1)}
      />
      {failure && (
        <ErrorState
          announce={false}
          title="无法读取逐行追溯"
          description={failure}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
      {data?.kind === 'unavailable' && (
        <div className="empty-state">
          <h3>无法逐行追溯</h3>
          <p>{data.message}</p>
        </div>
      )}
      {data?.kind === 'ready' && (
        <CodeView
          path={data.path}
          text={data.content.replace(/\r\n/g, '\n').replace(/\n$/, '')}
          lines={data.lines.length}
          language={fileLanguage(data.path)}
          scrollKey={JSON.stringify([repoId, data.path, data.revision ?? 'worktree'])}
          focusLine={data.focusLine}
          annotations={
            <div className="blame-gutter" aria-label="逐行追溯">
              {groups.map((lines) => (
                <BlameBlock
                  key={lines[0].line}
                  repoId={repoId}
                  lines={lines}
                  data={data}
                  onSelectCommit={onSelectCommit}
                  onPrevious={(line) =>
                    setVersions((all) => [
                      ...all.slice(0, -1),
                      { path: data.path, revision: data.revision },
                      {
                        path: data.path,
                        revision: data.revision,
                        previousLine: line,
                        expectedVersion: data.version,
                      },
                    ])
                  }
                />
              ))}
            </div>
          }
        />
      )}
    </>
  );
}
