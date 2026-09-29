import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Spin, Tabs, Tag } from 'antd';
import { ArrowLeftOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import type {
  PullRequestDetailQuery,
  PullRequestDiscussion,
  PullRequestDiscussionKind,
  PullRequestFile,
  PullRequestItem,
  PullRequestProvider,
  PullRequestRemote,
  PullRequestResourcePage,
} from '@alune/shared';
import { repositoryApi } from '../api';
import { errorMessage } from './files-tree';
import { getNumberedDiffLines } from './diff-lines';
import { MarkdownContent } from './ReleaseNotes';

// Match a result to its loader as well as aborting it, so changing identity never paints stale data.
function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    load: typeof load;
    retry: number;
    data?: T;
    error?: string;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ load, retry, data });
      },
      (failure) => {
        if (!controller.signal.aborted)
          setResult({ load, retry, error: errorMessage(failure, '读取失败，请重试。') });
      },
    );
    return () => controller.abort();
  }, [load, retry]);
  const current = result?.load === load && result.retry === retry ? result : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    retry: () => setRetry((value) => value + 1),
  };
}

function usePages<T>(
  load: (page: number, signal: AbortSignal) => Promise<PullRequestResourcePage<T>>,
) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<Record<number, PullRequestResourcePage<T>>>({});
  const loader = useCallback((signal: AbortSignal) => load(page, signal), [load, page]);
  const resource = useResource(loader);
  useEffect(() => {
    if (resource.data) setPages((previous) => ({ ...previous, [page]: resource.data! }));
  }, [resource.data, page]);
  const visible = resource.data ? { ...pages, [page]: resource.data } : pages;
  const ordered = Object.values(visible).sort((a, b) => a.page - b.page);
  return {
    ...resource,
    items: ordered.flatMap((result) => result.items),
    notice: [...new Set(ordered.map((result) => result.notice).filter(Boolean))].join(' '),
    hasMore: ordered.at(-1)?.hasMore,
    next: () => setPage((value) => value + 1),
  };
}

function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: string;
  retry: () => void;
}) {
  if (error)
    return (
      <Alert type="error" showIcon title={error} action={<Button onClick={retry}>重试</Button>} />
    );
  if (loading)
    return (
      <div className="pull-requests-loading" role="status">
        <Spin size="small" /> 正在读取…
      </div>
    );
  return null;
}

export function PullRequestPatch({ patch }: { patch: string }) {
  const lines = useMemo(() => getNumberedDiffLines(patch), [patch]);
  return (
    <div
      className="pull-request-patch"
      tabIndex={0}
      role="region"
      aria-label="文件 Diff，可横向滚动"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">旧行</th>
            <th scope="col">新行</th>
            <th scope="col">代码变动</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((row, index) => (
            <tr key={index} className={`pull-request-patch__${row.kind}`}>
              <td className="pull-request-patch__number">{row.oldLine}</td>
              <td className="pull-request-patch__number">{row.newLine}</td>
              <td>
                <code>{row.text || ' '}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function More({
  hasMore,
  loading,
  error,
  next,
}: {
  hasMore?: boolean;
  loading: boolean;
  error?: string;
  next: () => void;
}) {
  return hasMore ? (
    <Button className="pull-request-more" disabled={loading || Boolean(error)} onClick={next}>
      加载更多
    </Button>
  ) : null;
}

function Files({
  repoId,
  query,
  notice,
  expectedCount,
}: {
  repoId: string;
  query: PullRequestDetailQuery;
  notice?: string;
  expectedCount?: number | null;
}) {
  const load = useCallback(
    (page: number, signal: AbortSignal) =>
      repositoryApi.pullRequestFiles(repoId, { ...query, page }, signal),
    [repoId, query],
  );
  const resource = usePages(load);
  const [selected, setSelected] = useState<string | null>(null);
  const file = resource.items.find((item) => item.path === selected) || resource.items[0];
  const missing =
    !resource.loading &&
    !resource.error &&
    !resource.hasMore &&
    expectedCount != null &&
    resource.items.length < expectedCount;
  return (
    <div className="pull-request-files">
      {(notice || resource.notice || missing) && (
        <Alert
          type="warning"
          showIcon
          title={
            notice ||
            resource.notice ||
            '平台返回的文件数少于变动总数，部分文件可能被省略；请在浏览器中核对完整变动。'
          }
        />
      )}
      <LoadState {...resource} />
      {!resource.loading && !resource.error && !resource.items.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可展示的变动文件" />
      )}
      {file && (
        <div className="pull-request-files__layout">
          <nav className="pull-request-files__list" aria-label="变动文件">
            <p>
              已加载 {resource.items.length}
              {expectedCount != null ? ` / ${expectedCount}` : ''} 个文件
            </p>
            {resource.items.map((item) => (
              <button
                type="button"
                key={item.path}
                aria-pressed={item.path === file.path}
                onClick={() => setSelected(item.path)}
                title={item.path}
              >
                <span>{item.path}</span>
                <FileStats file={item} />
              </button>
            ))}
            <More {...resource} />
          </nav>
          <article className="pull-request-files__diff" aria-label={`Diff ${file.path}`}>
            <header>
              <strong>{file.path}</strong>
              <FileStats file={file} />
            </header>
            {file.previousPath && file.previousPath !== file.path && (
              <p className="pull-request-muted">原路径：{file.previousPath}</p>
            )}
            {file.notice && <Alert type="info" showIcon title={file.notice} />}
            {file.patch && <PullRequestPatch patch={file.patch} />}
          </article>
        </div>
      )}
    </div>
  );
}

function FileStats({ file }: { file: PullRequestFile }) {
  const status = { added: '新增', deleted: '删除', renamed: '重命名', modified: '修改' };
  return (
    <span className="pull-request-file-stats">
      <span>{status[file.status]}</span>
      {file.additions !== null && (
        <span className="pull-request-file-stats__add">+{file.additions}</span>
      )}
      {file.deletions !== null && (
        <span className="pull-request-file-stats__remove">−{file.deletions}</span>
      )}
    </span>
  );
}

export function mergeDiscussions(items: PullRequestDiscussion[]): PullRequestDiscussion[] {
  const threads = new Map<string, PullRequestDiscussion>();
  for (const item of items) {
    const previous = threads.get(item.id);
    const comments = new Map((previous?.comments || []).map((note) => [note.id, note]));
    for (const note of item.comments) comments.set(note.id, note);
    threads.set(item.id, { ...item, comments: [...comments.values()] });
  }
  return [...threads.values()];
}

const reviewStates: Record<string, string> = {
  APPROVED: '已批准',
  CHANGES_REQUESTED: '请求修改',
  COMMENTED: '已评论',
  DISMISSED: '已撤销',
  PENDING: '待提交',
};

export function DiscussionThread({ thread }: { thread: PullRequestDiscussion }) {
  return (
    <article className="pull-request-thread" aria-label="讨论串">
      {thread.resolved !== undefined && (
        <Tag color={thread.resolved ? 'green' : 'orange'}>
          {thread.resolved ? '已解决' : '未解决'}
        </Tag>
      )}
      {thread.comments.map((note, index) => (
        <section
          className="pull-request-comment"
          key={note.id}
          aria-label={`来自 ${note.author} 的评论`}
        >
          <header>
            <strong>{note.author}</strong>
            {note.createdAt && (
              <time dateTime={note.createdAt}>
                {new Date(note.createdAt).toLocaleString('zh-CN', { hour12: false })}
              </time>
            )}
            {note.system && <Tag>系统记录</Tag>}
            {note.reviewState && <Tag>{reviewStates[note.reviewState] || note.reviewState}</Tag>}
            {(note.replyTo || index > 0) && (
              <span>{note.replyTo ? `回复评论 #${note.replyTo}` : '回复'}</span>
            )}
          </header>
          {note.context && (
            <div className="pull-request-comment__context">
              <p>
                <code>{note.context.path}</code>
                {note.context.oldPath &&
                  note.context.oldPath !== note.context.path &&
                  `（原路径 ${note.context.oldPath}）`}
                {note.context.startLine && ` · 起始行 ${note.context.startLine}`}
                {note.context.oldLine && ` · 旧行 ${note.context.oldLine}`}
                {note.context.newLine && ` · 新行 ${note.context.newLine}`}
                {!note.context.oldLine && !note.context.newLine && ' · 文件级评论或行号不可用'}
                {note.context.outdated && <Tag>旧版本代码</Tag>}
              </p>
              {note.context.notice && <p className="pull-request-muted">{note.context.notice}</p>}
              {note.context.patch && (
                <details>
                  <summary>查看评论的代码上下文</summary>
                  <PullRequestPatch patch={note.context.patch} />
                </details>
              )}
            </div>
          )}
          <div className="release-notes pull-request-markdown">
            {note.body.trim() ? (
              <MarkdownContent text={note.body} />
            ) : (
              <p className="pull-request-muted">无评论正文</p>
            )}
          </div>
        </section>
      ))}
    </article>
  );
}

function Discussions({
  repoId,
  query,
  kind,
  title,
}: {
  repoId: string;
  query: PullRequestDetailQuery;
  kind: PullRequestDiscussionKind;
  title: string;
}) {
  const load = useCallback(
    (page: number, signal: AbortSignal) =>
      repositoryApi.pullRequestDiscussions(repoId, { ...query, page, kind }, signal),
    [repoId, query, kind],
  );
  const resource = usePages(load);
  const threads = mergeDiscussions(resource.items);
  return (
    <section className="pull-request-discussions" aria-label={title}>
      <h3>{title}</h3>
      <LoadState {...resource} />
      {!resource.loading && !resource.error && !threads.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${title}`} />
      )}
      {threads.map((thread) => (
        <DiscussionThread key={thread.id} thread={thread} />
      ))}
      <More {...resource} />
    </section>
  );
}

function DetailContent({
  repoId,
  query,
  item,
  tab,
  onTabChange,
}: {
  repoId: string;
  query: PullRequestDetailQuery;
  item?: PullRequestItem;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => repositoryApi.pullRequestDetail(repoId, query, signal),
    [repoId, query],
  );
  const resource = useResource(load);
  const detail = resource.data;
  const summary = detail || item;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <>
      <header className="pull-request-detail__header">
        <h2 tabIndex={-1} ref={heading}>
          {summary?.title || 'PR/MR 详情'}{' '}
          <span>
            {query.provider === 'github' ? '#' : '!'}
            {query.number}
          </span>
        </h2>
        {summary && (
          <>
            <div className="pull-request-detail__meta">
              <Tag
                color={
                  summary.state === 'merged'
                    ? 'purple'
                    : summary.state === 'open'
                      ? 'green'
                      : 'default'
                }
              >
                {{ open: '开放中', closed: '已关闭', merged: '已合并' }[summary.state]}
              </Tag>
              {summary.draft && <Tag>草稿</Tag>}
              <span>{summary.author}</span>
              <time dateTime={summary.updatedAt}>
                更新于 {new Date(summary.updatedAt).toLocaleString('zh-CN', { hour12: false })}
              </time>
            </div>
            <p className="pull-request-detail__branches">
              {summary.sourceBranch || '已删除分支'} → {summary.targetBranch || '未知分支'}
            </p>
          </>
        )}
      </header>
      <LoadState {...resource} />
      <Tabs
        activeKey={tab}
        onChange={onTabChange}
        items={[
          {
            key: 'overview',
            label: '概览',
            children: detail && (
              <div className="release-notes pull-request-markdown pull-request-description">
                {detail.description.trim() ? (
                  <MarkdownContent text={detail.description} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无描述" />
                )}
              </div>
            ),
          },
          {
            key: 'files',
            label: `文件变动${detail?.fileCount != null ? ` (${detail.fileCount})` : ''}`,
            children: (
              <Files
                repoId={repoId}
                query={query}
                notice={detail?.filesNotice}
                expectedCount={detail?.fileCount}
              />
            ),
          },
          {
            key: 'discussions',
            label: '评论与讨论',
            children: (
              <>
                <Discussions
                  repoId={repoId}
                  query={query}
                  kind="comments"
                  title={query.provider === 'github' ? '评论' : '评论与代码讨论'}
                />
                {query.provider === 'github' && (
                  <>
                    <Discussions repoId={repoId} query={query} kind="reviews" title="Review 记录" />
                    <Discussions repoId={repoId} query={query} kind="code" title="代码行讨论" />
                  </>
                )}
              </>
            ),
          },
        ]}
      />
    </>
  );
}

export function PullRequestDetails({
  repoId,
  remote,
  provider,
  number,
  token,
  items,
  refreshToken,
  onOpen,
  onBack,
}: {
  repoId: string;
  remote: PullRequestRemote;
  provider: PullRequestProvider;
  number: number;
  token: string | null;
  items: PullRequestItem[];
  refreshToken: number;
  onOpen: (number: number) => void;
  onBack: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState('overview');
  const query = useMemo(
    () => ({
      remote: remote.name,
      target: remote.webUrl,
      provider,
      number,
      ...(token !== null ? { token } : {}),
    }),
    [remote.name, remote.webUrl, provider, number, token],
  );
  const item = items.find((value) => value.number === number);
  const url = `${remote.webUrl}/${provider === 'github' ? 'pull' : '-/merge_requests'}/${number}`;
  return (
    <div className="pull-request-detail" aria-label="PR/MR 详情">
      <div className="pull-request-detail__toolbar">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回列表
        </Button>
        <Select
          aria-label="切换 PR/MR"
          value={number}
          onChange={onOpen}
          options={(item ? items : [{ number, title: '当前条目' }, ...items]).map((entry) => ({
            value: entry.number,
            label: `${provider === 'github' ? '#' : '!'}${entry.number} ${entry.title}`,
          }))}
        />
        <Button
          icon={<ReloadOutlined />}
          aria-label="刷新详情"
          onClick={() => setRefresh((value) => value + 1)}
        >
          刷新详情
        </Button>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExportOutlined /> 在浏览器中打开
        </a>
      </div>
      <DetailContent
        key={`${refreshToken}:${refresh}`}
        repoId={repoId}
        query={query}
        item={item}
        tab={tab}
        onTabChange={setTab}
      />
    </div>
  );
}
