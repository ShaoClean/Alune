import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, DialogIcon, Empty, Input, Select, Segmented, Spin } from '@alune/ui';
import type {
  PullRequestAccount,
  PullRequestCenterItem,
  PullRequestCenterQuery,
  PullRequestSource,
} from '@alune/shared';
import { PullRequestRow } from '../components/PullRequestsView';
import { PullRequestDetails } from '../components/PullRequestDetails';
import {
  usePullRequestCenter,
  centerListUrl,
  centerParams,
  centerQueryKey,
  defaultCenterQuery,
  readCenterQuery,
} from '../stores/pullRequestCenter';
import { pullRequestCenterApi, repositoryApi } from '../api';
import { useAccessTokensStore } from '../stores/accessTokensStore';
import { errorMessage } from '../components/files-tree';

function CenterDrawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pr-center-drawer"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right) onClose();
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <Button type="text" onClick={onClose} aria-label={`关闭${title}`}>
          关闭
        </Button>
      </header>
      <div className="pr-center-drawer__body">{children}</div>
    </dialog>
  );
}

function SourceConfiguration({
  source,
  onApplied,
  onManage,
}: {
  source: PullRequestSource;
  onApplied: () => void;
  onManage: () => void;
}) {
  const { settings, load, accept } = useAccessTokensStore();
  const [provider, setProvider] = useState(source.provider || 'gitlab');
  const [tokenId, setTokenId] = useState(source.remote?.selection?.tokenId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    void load();
  }, [load]);
  const remote = source.remote;
  if (!remote || remote.unavailableReason) return null;
  const apply = async () => {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      accept(
        await repositoryApi.applyAccessToken(source.repositoryId, {
          remote: remote.name,
          target: remote.webUrl,
          provider,
          tokenId: tokenId || null,
          revision: settings.revision,
        }),
      );
      usePullRequestCenter.getState().invalidate();
      onApplied();
    } catch (failure) {
      setError(errorMessage(failure, '无法保存配置'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pr-center-source-config">
      {!remote.provider && (
        <Select
          aria-label="托管平台"
          value={provider}
          onChange={setProvider}
          options={[{ label: 'GitLab（已确认此主机为 GitLab）', value: 'gitlab' }]}
          getPopupContainer={(node) => node.parentElement!}
        />
      )}
      <Select
        aria-label={`访问令牌 ${source.repositoryName} ${remote.name}`}
        value={tokenId}
        onChange={setTokenId}
        getPopupContainer={(node) => node.parentElement!}
        options={[
          { label: '不使用令牌（匿名读取）', value: '' },
          ...(
            settings?.tokens.filter(
              (token) =>
                !token.scope ||
                (token.scope.provider === provider &&
                  token.scope.origin === new URL(remote.webUrl).origin),
            ) || []
          ).map((token) => ({ label: token.name, value: token.id })),
        ]}
      />
      {error && <p role="alert">{error}</p>}
      <div className="pr-center-actions">
        <Button onClick={() => void apply()} loading={busy} disabled={!settings}>
          保存关联
        </Button>
        <Button
          type="text"
          onClick={() => {
            onManage();
            navigate('/settings/tokens', {
              state: { returnTo: `${location.pathname}${location.search}` },
            });
          }}
        >
          管理访问令牌
        </Button>
      </div>
    </div>
  );
}

function CenterDetail({
  source,
  sources,
  number,
  items,
  query,
  onSources,
}: {
  source: PullRequestSource;
  sources: PullRequestSource[];
  number: number;
  items: PullRequestCenterItem[];
  query: PullRequestCenterQuery;
  onSources: () => void;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [context, setContext] = useState<{
    account: PullRequestAccount | null;
    identityNotice?: string;
  }>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const remote = source.remote!;
  const expectedVersion = params.get('actorVersion') ?? remote.selection?.version ?? '';
  const expectedTarget = params.get('target') || remote.webUrl;
  useEffect(() => {
    const controller = new AbortController();
    setContext(undefined);
    setError('');
    void pullRequestCenterApi
      .context(
        source.repositoryId,
        {
          remote: remote.name,
          target: expectedTarget,
          provider: source.provider!,
          state: 'open',
          page: 1,
          selectionVersion: expectedVersion,
        },
        controller.signal,
      )
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorMessage(failure, '无法确认操作账号'));
      });
    return () => controller.abort();
  }, [source.id, source.provider, remote.name, expectedTarget, expectedVersion, retry]);
  const open = (selected: PullRequestSource, value = number) => {
    const next = centerParams(query);
    next.set('remote', selected.remote!.name);
    next.set('target', selected.remote!.webUrl);
    next.set('actorVersion', selected.remote!.selection?.version || '');
    navigate(`/pull-requests/${selected.repositoryId}/${value}?${next}`, { replace: true });
  };
  const alternatives = sources.filter(
    (candidate) =>
      candidate.projectKey === source.projectKey &&
      candidate.remote &&
      candidate.provider &&
      ['ready', 'success'].includes(candidate.status),
  );
  const identityMissing = Boolean(source.remote?.selection?.tokenId && context && !context.account);
  return (
    <section className="pr-center-detail" aria-label="中心 PR/MR 详情">
      <header className="pr-center-detail__bar">
        <Button onClick={() => navigate(centerListUrl(query))}>← 返回 PR/MR 中心</Button>
        <span className="pr-center-project">
          {remote.host} / <strong>{remote.project}</strong> ·{' '}
          {source.provider === 'github' ? '#' : '!'}
          {number}
        </span>
        <Button
          type="text"
          onClick={() =>
            navigate(
              `/repositories/${source.repositoryId}?panel=pull-requests&remote=${encodeURIComponent(remote.name)}`,
            )
          }
        >
          打开所属仓库
        </Button>
      </header>
      <div className="pr-center-actor">
        <span>
          操作账号：
          {context
            ? context.account
              ? `${context.account.host} / @${context.account.username}`
              : identityMissing
                ? '账号未识别'
                : '匿名（只读）'
            : '正在确认…'}
        </span>
        {alternatives.length > 1 && (
          <Select
            aria-label="切换操作账号及来源"
            value={source.id}
            onChange={(id) => open(alternatives.find((s) => s.id === id)!)}
            options={alternatives.map((s) => ({
              value: s.id,
              label: `${s.account ? `@${s.account.username}` : s.remote?.selection?.tokenId ? '关联账号' : '匿名'} · ${s.repositoryName} · ${s.remote!.name} · ${s.location}`,
            }))}
          />
        )}
        <Button type="text" onClick={onSources}>
          访问配置
        </Button>
      </div>
      {error ? (
        <div className="pr-center-notice" role="alert">
          {error}
          <Button onClick={() => setRetry((n) => n + 1)}>重试</Button>
          {(expectedVersion !== (remote.selection?.version || '') ||
            expectedTarget !== remote.webUrl) && (
            <Button onClick={() => open(source)}>确认使用当前来源</Button>
          )}
        </div>
      ) : identityMissing ? (
        <div className="pr-center-notice" role="alert">
          {context?.identityNotice} 请确认账号后再打开审阅操作。
          <Button onClick={() => setRetry((n) => n + 1)}>重新确认</Button>
        </div>
      ) : !context ? (
        <div className="pr-center-empty">
          <Spin />
          正在确认访问身份…
        </div>
      ) : (
        <PullRequestDetails
          key={`${source.id}:${expectedVersion}:${number}`}
          repoId={source.repositoryId}
          remote={remote}
          provider={source.provider!}
          number={number}
          token={null}
          selectionVersion={expectedVersion}
          items={items.filter((item) => item.projectKey === source.projectKey)}
          refreshToken={retry}
          onBack={() => navigate(centerListUrl(query))}
          onOpen={(value) => open(source, value)}
          onChanged={() => usePullRequestCenter.getState().invalidate()}
        />
      )}
    </section>
  );
}

export function PullRequestCenterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname.startsWith('/pull-requests');
  const { repositoryId, number } = useParams();
  const [params, setParams] = useSearchParams();
  const queryString = params.toString();
  const query = useMemo(() => readCenterQuery(new URLSearchParams(queryString)), [queryString]);
  const key = centerQueryKey(query);
  const { entries, load, stop, setScroll, revision } = usePullRequestCenter();
  const entry = entries[key];
  const [drawer, setDrawer] = useState<'sources' | 'filters' | null>(null);
  const [configuration, setConfiguration] = useState<string | null>(null);
  const [search, setSearch] = useState(query.search);
  const list = useRef<HTMLDivElement>(null);
  const remoteName = params.get('remote');
  const sources = entry?.page?.sources || entry?.discovery?.sources || [];
  const selected = sources.find(
    (s) => s.repositoryId === repositoryId && s.remote?.name === remoteName,
  );
  const detail = Boolean(repositoryId && number);
  useEffect(() => {
    if (!active) return;
    const cached = usePullRequestCenter.getState().entries[key];
    if (!cached?.page || (!detail && Date.now() - cached.updatedAt > 60_000)) void load(query);
    return () => stop();
  }, [key, detail, revision, load, stop, active]);
  useEffect(() => {
    setSearch(query.search);
  }, [query.search]);
  const change = (patch: Partial<PullRequestCenterQuery>) => {
    setScroll(key, 0);
    setParams(centerParams({ ...query, ...patch }));
  };
  useEffect(() => {
    if (!active || search === query.search || detail) return;
    const timer = setTimeout(() => change({ search }), 350);
    return () => clearTimeout(timer);
  }, [search, query.search, key, detail, active]);
  useLayoutEffect(() => {
    if (active && !detail && list.current)
      list.current.scrollTop = usePullRequestCenter.getState().entries[key]?.scroll || 0;
  }, [key, detail, active]);
  const projects = [
    ...new Map(
      sources
        .filter((s) => s.projectKey)
        .map((s) => [
          s.projectKey!,
          {
            value: s.projectKey!,
            label: `${s.remote!.host} / ${s.remote!.project} · ${sources
              .filter((x) => x.projectKey === s.projectKey)
              .map((x) => `${x.repositoryName} (${x.location})`)
              .join('、')}`,
          },
        ]),
    ).values(),
  ];
  const accounts = [
    ...new Map(
      sources
        .filter((s) => s.account)
        .map((s) => [
          s.account!.key,
          {
            value: s.account!.key,
            label: `${s.account!.host} / @${s.account!.username}`,
          },
        ]),
    ).values(),
  ];
  const problems = sources.filter((s) => ['error', 'configuration'].includes(s.status));
  const identityIncomplete =
    query.view !== 'all' &&
    sources.some(
      (s) =>
        s.projectKey &&
        !s.account &&
        (!query.provider || s.provider === query.provider) &&
        (!query.projects.length || query.projects.includes(s.projectKey)),
    );
  const refresh = () => void load(query);
  const openItem = (item: PullRequestCenterItem) => {
    const source = sources.find((s) => s.id === item.sourceId);
    if (!source?.remote) return;
    if (active && list.current) setScroll(key, list.current.scrollTop);
    const next = centerParams(query);
    next.set('remote', source.remote.name);
    next.set('target', source.remote.webUrl);
    next.set('actorVersion', source.remote.selection?.version || '');
    navigate(`/pull-requests/${source.repositoryId}/${item.number}?${next}`);
  };
  const filters = (
    <div className="pr-center-filters">
      <Input
        aria-label="搜索 PR/MR"
        placeholder="搜索标题、编号、作者或分支"
        allowClear
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Select
        mode="multiple"
        aria-label="筛选仓库"
        placeholder="全部仓库"
        maxTagCount="responsive"
        value={query.projects}
        onChange={(projects) => change({ projects })}
        options={projects}
        getPopupContainer={(node) => node.parentElement!}
      />
      <Select
        aria-label="筛选平台"
        value={query.provider}
        onChange={(provider) => change({ provider })}
        options={[
          { label: '全部平台', value: '' },
          { label: 'GitHub', value: 'github' },
          { label: 'GitLab', value: 'gitlab' },
        ]}
        getPopupContainer={(node) => node.parentElement!}
      />
      <Select
        aria-label="筛选账号"
        value={query.account}
        onChange={(account) => change({ account })}
        options={[{ label: '全部账号', value: '' }, ...accounts]}
        getPopupContainer={(node) => node.parentElement!}
      />
      <Select
        aria-label="筛选状态"
        value={query.state}
        disabled={query.view === 'review'}
        onChange={(state) => change({ state })}
        options={[
          { label: '开放', value: 'open' },
          { label: '已合并', value: 'merged' },
          { label: '已关闭', value: 'closed' },
          { label: '全部状态', value: 'all' },
        ]}
        getPopupContainer={(node) => node.parentElement!}
      />
      {key && (
        <Button type="text" onClick={() => change(defaultCenterQuery)}>
          清除筛选
        </Button>
      )}
    </div>
  );
  return (
    <div className={`pr-center${detail ? ' pr-center--detail' : ''}`}>
      {detail ? (
        selected?.remote && selected.provider ? (
          <CenterDetail
            key={`${selected.id}:${number}:${params.get('actorVersion')}`}
            source={selected}
            sources={sources}
            number={Number(number)}
            items={entry?.items || []}
            query={query}
            onSources={() => setDrawer('sources')}
          />
        ) : (
          <div className="pr-center-empty">
            <Button onClick={() => navigate(centerListUrl(query))}>返回 PR/MR 中心</Button>
            {entry?.loading ? (
              <>
                <Spin />
                正在读取来源…
              </>
            ) : (
              <>
                来源已移除或暂时无法读取。
                <Button onClick={() => setDrawer('sources')}>查看数据来源</Button>
                <Button onClick={refresh}>重试</Button>
              </>
            )}
          </div>
        )
      ) : (
        <>
          <header className="pr-center-header">
            <div>
              <h1>PR/MR 中心</h1>
              <p>
                {entry?.updatedAt
                  ? `最近刷新 ${new Date(entry.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                  : '汇总已添加仓库的请求与审阅'}
              </p>
            </div>
            <div className="pr-center-actions">
              <Button onClick={() => setDrawer('sources')}>
                数据来源{problems.length ? ` · ${problems.length} 项待处理` : ''}
              </Button>
              <Button
                icon={<DialogIcon name="refresh" />}
                loading={entry?.loading}
                onClick={refresh}
              >
                刷新
              </Button>
            </div>
          </header>
          <div className="pr-center-toolbar">
            <Segmented
              value={query.view}
              onChange={(view) =>
                change({
                  view: view as PullRequestCenterQuery['view'],
                  ...(view === 'review' ? { state: 'open' } : {}),
                })
              }
              options={[
                { label: '全部', value: 'all' },
                { label: '我创建的', value: 'created' },
                { label: '请求我审阅', value: 'review' },
              ]}
            />
            <Button className="pr-center-filter-toggle" onClick={() => setDrawer('filters')}>
              筛选
            </Button>
          </div>
          <div className="pr-center-desktop-filters">{filters}</div>
          {(problems.length > 0 || identityIncomplete) && (
            <div className="pr-center-notice" role="status">
              {problems.length > 0 ? `${problems.length} 个来源未能完整读取。` : ''}
              {identityIncomplete ? '部分来源无法识别账号，个人视图可能不完整。' : ''}
              <Button type="text" onClick={() => setDrawer('sources')}>
                查看并处理
              </Button>
            </div>
          )}
          {entry?.error && (
            <div className="pr-center-notice" role="alert">
              {entry.error}
              <Button onClick={refresh}>重新加载</Button>
            </div>
          )}
          <div
            className="pr-center-list"
            ref={list}
            onScroll={() => {
              if (active && list.current) setScroll(key, list.current.scrollTop);
            }}
          >
            <div className="pr-center-list-meta">
              <span>已加载 {entry?.items.length || 0} 条</span>
              <span>按最近更新排序</span>
            </div>
            {!!entry?.items.length && (
              <ul aria-label="跨仓库 PR/MR 列表">
                {entry.items.map((item) => (
                  <li className="pr-center-item" key={item.key}>
                    <div className="pr-center-item__project">
                      {item.provider === 'github' ? 'GitHub' : 'GitLab'}{' '}
                      <span>
                        {item.host} / <strong>{item.project}</strong>
                      </span>
                    </div>
                    <ul>
                      <PullRequestRow
                        item={item}
                        provider={item.provider}
                        onOpen={() => openItem(item)}
                      />
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {!entry?.items.length && !entry?.loading && !entry?.error && (
              <div className="pr-center-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    entry?.discovery?.repositoryCount === 0
                      ? '尚未添加仓库'
                      : entry?.page?.nextCursor
                        ? '当前扫描范围暂无匹配，仍有后续页面可查找'
                        : !entry?.discovery?.complete || !entry.page
                          ? '读取尚未完成，请刷新继续'
                          : !sources.some((s) => s.status === 'success') &&
                              (entry.page.totalSources > 0 ||
                                (problems.length > 0 && !sources.some((s) => s.status === 'ready')))
                            ? '来源未能读取，请检查连接或访问配置'
                            : !sources.some((s) => s.projectKey)
                              ? '没有受支持的远端'
                              : '没有符合条件的 PR/MR'
                  }
                />
                {entry?.discovery?.repositoryCount === 0 ? (
                  <Button onClick={() => navigate('/repositories?open=local')}>添加仓库</Button>
                ) : problems.length ? (
                  <Button onClick={() => setDrawer('sources')}>查看数据来源</Button>
                ) : (
                  key && <Button onClick={() => change(defaultCenterQuery)}>清除筛选</Button>
                )}
              </div>
            )}
            <footer className="pr-center-pagination" aria-live="polite">
              {entry?.loading ? (
                <>
                  <Spin size="small" />
                  <span>
                    {entry.discovery && !entry.discovery.complete
                      ? `正在发现来源 ${entry.discovery.discoveredCount}/${entry.discovery.repositoryCount}…`
                      : '正在读取与查找请求…'}
                  </span>
                  <Button type="text" onClick={stop}>
                    停止
                  </Button>
                </>
              ) : entry?.page?.nextCursor ? (
                <Button onClick={() => void load(query, 'more')}>
                  {entry.page.scanning ? '继续查找' : '加载更多'}
                </Button>
              ) : (
                entry?.page && (
                  <span>{problems.length ? '可用来源已加载，部分来源需要处理' : '已全部加载'}</span>
                )
              )}
            </footer>
          </div>
        </>
      )}
      {drawer && (
        <CenterDrawer
          title={drawer === 'sources' ? '数据来源' : '筛选'}
          onClose={() => setDrawer(null)}
        >
          {drawer === 'filters' ? (
            filters
          ) : (
            <>
              <p>按仓库与远端检查访问状态。同一项目的请求在列表中自动合并。</p>
              <Button onClick={refresh} loading={entry?.loading}>
                重新发现与读取
              </Button>
              <div className="pr-center-sources">
                {sources.map((source) => (
                  <section key={source.id}>
                    <header>
                      <strong>
                        {source.repositoryName} · {source.remote?.name || '仓库'}
                      </strong>
                      <span>
                        {
                          {
                            ready: '等待读取',
                            success: '读取成功',
                            configuration: '待配置',
                            unsupported: '不支持',
                            error: '读取失败',
                          }[source.status]
                        }
                      </span>
                    </header>
                    <p>
                      {source.remote?.host}
                      {source.remote?.project ? ` / ${source.remote.project}` : ''}
                    </p>
                    <p>{source.location}</p>
                    {source.account && <p>关联账号：@{source.account.username}</p>}
                    {source.message && <p role="status">{source.message}</p>}
                    {source.identityNotice && <p>{source.identityNotice}</p>}
                    <div className="pr-center-actions">
                      {source.remote && !source.remote.unavailableReason && (
                        <Button
                          size="small"
                          onClick={() =>
                            setConfiguration(configuration === source.id ? null : source.id)
                          }
                        >
                          访问配置
                        </Button>
                      )}
                      {source.status === 'error' && (
                        <Button size="small" onClick={refresh}>
                          重试
                        </Button>
                      )}
                    </div>
                    {configuration === source.id && (
                      <SourceConfiguration
                        source={source}
                        onManage={() => setDrawer(null)}
                        onApplied={() => {
                          setConfiguration(null);
                          refresh();
                        }}
                      />
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </CenterDrawer>
      )}
    </div>
  );
}
