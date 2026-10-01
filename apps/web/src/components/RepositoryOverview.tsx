import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Pagination } from '@alune/ui';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Repository } from '@alune/shared';
import { useNavigate } from 'react-router-dom';
import { useRepositoryStore } from '../stores/repositoryStore';
import { buildRepositoryOverview, syncLabel } from '../stores/repositoryOverview';
import type { OverviewRow, WorkspaceState } from '../stores/repositoryOverview';
import { useRepositoryAnalytics } from '../hooks/useRepositoryAnalytics';
import { AluneModal } from '@alune/ui';

const labels: Record<WorkspaceState, string> = { clean: '干净', dirty: '有改动', unknown: '未知' };
const percent = (value: number, total: number) =>
  total ? `${Math.round((value / total) * 100)}%` : '—';
const dateTime = (value?: number) => (value ? new Date(value).toLocaleString() : '尚未采集');
const number = (value: number) => value.toLocaleString();
type Detail = { title: string; match: (row: OverviewRow) => boolean };

function Panel({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overview-panel ${className}`} aria-label={title}>
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function RepositoryRows({
  rows,
  sourceName,
  onRetry,
  busy,
}: {
  rows: OverviewRow[];
  sourceName: (id: string) => string;
  onRetry: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const ids = rows.map((row) => row.repo.id).join(',');
  useEffect(() => setPage(1), [ids]);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)));
  if (!rows.length) return <p className="overview-empty">没有符合条件的仓库。</p>;
  return (
    <>
      <div
        className="collection-table-scroll"
        role="region"
        aria-label="仓库明细，可横向滚动"
        tabIndex={0}
      >
        <table className="collection-table overview-table">
          <thead>
            <tr>
              <th scope="col">仓库 / 来源</th>
              <th scope="col">分支</th>
              <th scope="col">工作区 / 同步</th>
              <th scope="col">统计 / 更新时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((current - 1) * 20, current * 20).map((row) => {
              const status = row.status;
              const stateReason =
                row.statusEntry?.error ||
                (row.statusEntry?.data ? '状态缓存已过期，请刷新' : '尚未获取状态');
              const activityReason =
                row.analyticsEntry?.error ||
                (row.analyticsEntry?.data ? '统计缓存已过期，请采集' : '尚未采集统计');
              return (
                <tr key={row.repo.id}>
                  <th scope="row">
                    <strong>{row.repo.name}</strong>
                    <small>{sourceName(row.source)}</small>
                    <small className="overview-path" title={row.repo.path}>
                      {row.repo.path}
                    </small>
                  </th>
                  <td>
                    {status
                      ? status.unborn
                        ? `${status.branch} · 未首次提交`
                        : status.branch && status.branch !== 'HEAD'
                          ? status.branch
                          : '游离 HEAD'
                      : '分支待确认'}
                  </td>
                  <td>
                    <span className={`overview-state is-${row.state}`}>
                      {labels[row.state]}
                      {row.state === 'dirty' ? ` · ${row.changedFiles} 文件` : ''}
                    </span>
                    <small>{syncLabel(row)}</small>
                    {!status && <small>{stateReason}</small>}
                    <small>状态：{dateTime(row.statusEntry?.updatedAt)}</small>
                  </td>
                  <td>
                    {row.analytics
                      ? `${row.commits} 次提交${row.limited ? '（历史不完整）' : ''}`
                      : activityReason}
                    <small>{row.language}</small>
                    {row.analytics?.languageError && <small>{row.analytics.languageError}</small>}
                    <small>统计：{dateTime(row.analyticsEntry?.data?.collectedAt)}</small>
                  </td>
                  <td>
                    <Button
                      size="small"
                      onClick={() => {
                        useRepositoryStore.getState().openRepository(row.repo);
                        navigate(`/repositories/${row.repo.id}`);
                      }}
                    >
                      打开工作区
                    </Button>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => void onRetry(row.repo.id)}
                      aria-label={`重新采集 ${row.repo.name}`}
                    >
                      重新采集
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 20 && (
        <Pagination
          size="small"
          current={current}
          total={rows.length}
          pageSize={20}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function RepositoryOverview({
  repositories,
  connections,
  revision,
}: {
  repositories: Repository[];
  connections: { id: string; name: string }[];
  revision: number;
}) {
  const [days, setDays] = useState(30);
  const [now, setNow] = useState(Date.now);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [trendOpen, setTrendOpen] = useState(false);
  const [attention, setAttention] = useState('all');
  const root = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const trendTrigger = useRef<HTMLElement | null>(null);
  const restoreFocus = (trigger: HTMLElement | null) => {
    const target =
      trigger?.isConnected && trigger !== document.body && trigger.getBoundingClientRect().height
        ? trigger
        : root.current?.querySelector<HTMLButtonElement>('.overview-metric');
    target?.focus({ preventScroll: true });
  };
  const statuses = useRepositoryStore((state) => state.repositoryStatuses);
  const ids = useMemo(() => repositories.map((repo) => repo.id), [repositories]);
  const { entries, busy, progress, collect, cancel, retry } = useRepositoryAnalytics(ids, revision);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const overview = useMemo(
    () => buildRepositoryOverview(repositories, statuses, entries, days, now),
    [repositories, statuses, entries, days, now],
  );
  const { rows, states, current, previous } = overview;
  const sourceName = (id: string) =>
    id === '@local'
      ? '本机'
      : `SSH · ${connections.find((item) => item.id === id)?.name || '未知连接'}`;
  const open = (title: string, match: Detail['match']) => {
    detailTrigger.current = document.activeElement as HTMLElement;
    setDetail({ title, match });
  };
  const knownStatus = rows.filter((row) => row.state !== 'unknown').length;
  const dirty = rows.filter((row) => row.state === 'dirty');
  const unknown = rows.filter((row) => row.state === 'unknown');
  const local = rows.filter((row) => row.source === '@local').length;
  const activityValue = (value: number) =>
    overview.collected.length || !rows.length ? number(value) : '—';
  const comparison = !overview.activityComplete
    ? '覆盖不完整，暂不计算环比'
    : overview.previousCommits === 0
      ? overview.commits
        ? '上期为 0，本期新增提交'
        : '本期与上期均无提交'
      : `较上期 ${(((overview.commits - overview.previousCommits) / overview.previousCommits) * 100).toFixed(1)}%`;
  const attentionRows = rows.filter((row) =>
    attention === 'dirty'
      ? row.state === 'dirty'
      : attention === 'sync'
        ? row.ahead || row.behind
        : attention === 'unknown'
          ? row.state === 'unknown' || !row.analytics || row.limited || row.analytics.languageError
          : row.state !== 'clean' ||
            row.ahead ||
            row.behind ||
            !row.analytics ||
            row.limited ||
            row.analytics.languageError,
  );
  const max = Math.max(1, ...current, ...previous);
  const points = (values: number[]) =>
    values
      .map((value, index) => `${40 + (index / (days - 1)) * 600},${160 - (value / max) * 120}`)
      .join(' ');
  const collectedTimes = overview.collected.map((row) => row.analytics!.collectedAt);
  const activityNote = overview.activityComplete
    ? '当前 HEAD · 完整覆盖'
    : `可用 ${overview.collected.length}/${rows.length} · ${rows.filter((row) => row.limited).length} 个历史不完整`;
  let ringOffset = 0;
  return (
    <div className="repository-overview" ref={root}>
      <div className="overview-toolbar">
        <div>
          <h3>数据总览</h3>
          <p>规模、活动与工作区状态，一处掌握。</p>
        </div>
        <div className="overview-toolbar__actions">
          <div className="collection-view-switch" role="group" aria-label="统计周期">
            {[7, 30, 90].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => setDays(value)}
              >
                近 {value} 天
              </button>
            ))}
          </div>
          <Button
            type="primary"
            aria-label="采集统计"
            icon={<ReloadOutlined />}
            disabled={!rows.length || busy}
            onClick={() => void collect(true)}
          >
            采集统计
          </Button>
          {busy && <Button onClick={cancel}>停止采集</Button>}
        </div>
      </div>
      <div className="overview-coverage" role="status" aria-live="polite">
        <span>
          {busy
            ? `正在读取 ${progress}/${rows.length} 个仓库`
            : `统计覆盖 ${overview.collected.length}/${rows.length} · 有效状态 ${knownStatus}/${rows.length}`}
        </span>
        <span>
          {collectedTimes.length
            ? `统计更新时间：${dateTime(Math.min(...collectedTimes))}${dateTime(Math.min(...collectedTimes)) !== dateTime(Math.max(...collectedTimes)) ? ` — ${dateTime(Math.max(...collectedTimes))}` : ''}`
            : '点击“采集统计”读取当前范围；打开页面仅使用缓存。'}
        </span>
      </div>
      <div className="overview-metrics">
        {[
          {
            label: '仓库总数',
            value: number(rows.length),
            note: `本机 ${local} · SSH ${rows.length - local}`,
            match: () => true,
          },
          {
            label: '活跃仓库',
            value: activityValue(overview.active.length),
            note: `${percent(overview.active.length, rows.length)}${overview.activityComplete ? ' 的仓库有提交' : ' 已确认活跃 · 覆盖不完整'}`,
            match: (row: OverviewRow) => (row.commits || 0) > 0,
          },
          {
            label: '本期提交',
            value: activityValue(overview.commits),
            note: comparison,
            match: (row: OverviewRow) => (row.commits || 0) > 0,
          },
          {
            label: '有未提交改动',
            value: knownStatus || !rows.length ? number(dirty.length) : '—',
            note: `${dirty.reduce((n, row) => n + row.changedFiles, 0)} 个已知改动文件 · ${unknown.length} 个待确认`,
            match: (row: OverviewRow) => row.state === 'dirty',
          },
          {
            label: '待同步仓库',
            value: knownStatus || !rows.length ? number(overview.syncedPending.length) : '—',
            note: `待推送 ${rows.filter((row) => row.ahead).length} · 待拉取 ${rows.filter((row) => row.behind).length} · 已知状态`,
            match: (row: OverviewRow) => row.ahead || row.behind,
          },
          {
            label: '状态待确认',
            value: number(unknown.length),
            note: '未获取、过期或读取失败',
            match: (row: OverviewRow) => row.state === 'unknown',
          },
        ].map((metric) => (
          <button
            type="button"
            className="overview-metric"
            key={metric.label}
            onClick={() => open(metric.label, metric.match)}
          >
            <span>
              {metric.label}
              <ArrowRightOutlined aria-hidden="true" />
            </span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </button>
        ))}
      </div>
      <div className="overview-charts">
        <Panel
          title="提交趋势"
          description={`${overview.dates[0]} — ${overview.dates.at(-1)} · UTC 完整日`}
          className="overview-trend"
        >
          <div className="overview-chart-meta">
            <span>
              <i className="overview-dot is-current" />
              本期
            </span>
            <span>
              <i className="overview-dot is-previous" />
              上期
            </span>
            <span>{activityNote}</span>
          </div>
          {overview.collected.length || !rows.length ? (
            <>
              <svg
                className="overview-line"
                viewBox="0 0 680 190"
                role="img"
                aria-label="本期与上一等长周期的每日提交数量；逐日数据见下方按钮"
              >
                {[0, 0.5, 1].map((ratio) => (
                  <g key={ratio}>
                    <line
                      x1="40"
                      x2="640"
                      y1={160 - ratio * 120}
                      y2={160 - ratio * 120}
                      className="overview-gridline"
                    />
                    <text x="30" y={164 - ratio * 120} textAnchor="end">
                      {Math.round(max * ratio)}
                    </text>
                  </g>
                ))}
                <polygon points={`40,160 ${points(current)} 640,160`} className="overview-area" />
                <polyline points={points(previous)} className="overview-previous-line" />
                <polyline points={points(current)} className="overview-current-line" />
                {current.map((count, index) => (
                  <circle
                    key={index}
                    cx={40 + (index / (days - 1)) * 600}
                    cy={160 - (count / max) * 120}
                    r="5"
                    className="overview-point"
                  >
                    <title>
                      {overview.dates[index]}：{count} 次；上期 {overview.previousDates[index]}：
                      {previous[index]} 次
                    </title>
                  </circle>
                ))}
                <text x="40" y="185">
                  {overview.dates[0].slice(5)}
                </text>
                <text x="640" y="185" textAnchor="end">
                  {overview.dates.at(-1)!.slice(5)}
                </text>
              </svg>
              <div className="overview-trend-footer">
                <span>
                  日均 <b>{(overview.commits / days).toFixed(1)}</b>
                </span>
                <span>
                  峰值 <b>{Math.max(0, ...current)}</b>
                </span>
                <span>
                  活动天数{' '}
                  <b>
                    {current.filter(Boolean).length}/{days}
                  </b>
                </span>
                <button
                  type="button"
                  className="overview-link"
                  onClick={() => {
                    trendTrigger.current = document.activeElement as HTMLElement;
                    setTrendOpen(true);
                  }}
                >
                  逐日明细 →
                </button>
              </div>
            </>
          ) : (
            <p className="overview-empty">尚无有效提交数据。采集后显示本期与上期趋势。</p>
          )}
        </Panel>
        <Panel
          title="工作区状态"
          description={`当前快照 · 有效状态覆盖率 ${percent(knownStatus, rows.length)}`}
        >
          <div className="overview-state-chart">
            <svg viewBox="0 0 160 160" className="overview-ring" aria-hidden="true">
              <circle cx="80" cy="80" r="58" pathLength="100" className="overview-ring-track" />
              {states.map(({ state, rows: group }) => {
                const length = rows.length ? (group.length / rows.length) * 100 : 0;
                const offset = ringOffset;
                ringOffset += length;
                return (
                  <circle
                    key={state}
                    cx="80"
                    cy="80"
                    r="58"
                    pathLength="100"
                    className={`overview-ring-segment is-${state}`}
                    strokeDasharray={`${length} ${100 - length}`}
                    strokeDashoffset={-offset}
                    onClick={() => open(`工作区 · ${labels[state]}`, (row) => row.state === state)}
                    transform="rotate(-90 80 80)"
                  />
                );
              })}
              <text x="80" y="78" textAnchor="middle" className="overview-ring-total">
                {rows.length}
              </text>
              <text x="80" y="99" textAnchor="middle">
                个仓库
              </text>
            </svg>
            <div className="overview-legend">
              {states.map(({ state, rows: group }) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => open(`工作区 · ${labels[state]}`, (row) => row.state === state)}
                >
                  <i className={`overview-dot is-${state}`} />
                  <span>{labels[state]}</span>
                  <b>{group.length}</b>
                  <small>{percent(group.length, rows.length)}</small>
                </button>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="来源分布" description="按工作区状态拆分 · 点击色段查看交集">
          <div className="overview-source-list">
            {overview.sources.map((source) => (
              <div key={source.source} className="overview-source">
                <div>
                  <button
                    type="button"
                    className="overview-link"
                    onClick={() =>
                      open(sourceName(source.source), (row) => row.source === source.source)
                    }
                  >
                    {sourceName(source.source)}
                  </button>
                  <span>{source.rows.length}</span>
                </div>
                <div
                  className="overview-stack"
                  style={{
                    width: percent(
                      source.rows.length,
                      Math.max(...overview.sources.map((item) => item.rows.length)),
                    ),
                  }}
                >
                  {states.map(({ state }) => {
                    const count = source.rows.filter((row) => row.state === state).length;
                    return count ? (
                      <button
                        key={state}
                        type="button"
                        className={`is-${state}`}
                        style={{ flex: count }}
                        aria-label={`${sourceName(source.source)} · ${labels[state]} · ${count} 个仓库`}
                        title={`${labels[state]} ${count}`}
                        onClick={() =>
                          open(
                            `${sourceName(source.source)} · ${labels[state]}`,
                            (row) => row.source === source.source && row.state === state,
                          )
                        }
                      >
                        {count}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            ))}
          </div>
          {!rows.length && <p className="overview-empty">暂无仓库来源。</p>}
          <p className="overview-footnote">
            {states.map(({ state }) => (
              <span key={state}>
                <i className={`overview-dot is-${state}`} />
                {labels[state]}
              </span>
            ))}
          </p>
        </Panel>
        <Panel title="活跃仓库排行" description={`Top 5 · ${activityNote}`}>
          <div className="overview-bars">
            {overview.ranking.map((row, index) => (
              <button
                type="button"
                key={row.repo.id}
                onClick={() => open(row.repo.name, (item) => item.repo.id === row.repo.id)}
              >
                <span className="overview-bar-label">
                  <span>
                    {index + 1}. {row.repo.name}
                    <small>{sourceName(row.source)}</small>
                  </span>
                  <b>
                    {row.commits}
                    <small>{percent(row.commits!, overview.commits)}</small>
                  </b>
                </span>
                <span className="overview-bar-track">
                  <i style={{ width: percent(row.commits!, overview.ranking[0].commits!) }} />
                </span>
              </button>
            ))}
          </div>
          {!overview.ranking.length && (
            <p className="overview-empty">
              {overview.collected.length || !rows.length
                ? '已采集范围在本期没有提交。'
                : '尚未采集活动数据。'}
            </p>
          )}
          <p className="overview-footnote">占比基于范围内已采集提交总数。</p>
        </Panel>
        <Panel title="主要语言分布" description="按仓库主要语言计数 · 非代码行数占比">
          <div className="overview-bars">
            {overview.languages.map((item) => (
              <button
                type="button"
                key={item.language}
                onClick={() =>
                  open(`主要语言 · ${item.language}`, (row) => row.language === item.language)
                }
              >
                <span className="overview-bar-label">
                  <span>{item.language}</span>
                  <b>
                    {item.rows.length}
                    <small>{percent(item.rows.length, rows.length)}</small>
                  </b>
                </span>
                <span className="overview-bar-track">
                  <i style={{ width: percent(item.rows.length, rows.length) }} />
                </span>
              </button>
            ))}
          </div>
          {!rows.length && <p className="overview-empty">暂无仓库语言。</p>}
        </Panel>
      </div>
      <section className="overview-panel overview-attention">
        <header>
          <div>
            <h3>
              需要关注的仓库 <span className="count-badge">{attentionRows.length}</span>
            </h3>
            <p>工作区状态与同步信息为当前快照。</p>
          </div>
          <div className="collection-view-switch" role="group" aria-label="关注仓库筛选">
            {[
              ['all', '全部'],
              ['dirty', '有改动'],
              ['sync', '待同步'],
              ['unknown', '未知 / 异常'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={attention === value}
                onClick={() => setAttention(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <RepositoryRows rows={attentionRows} sourceName={sourceName} onRetry={retry} busy={busy} />
      </section>
      <details className="overview-method">
        <summary>统计口径与覆盖说明</summary>
        <p>
          活动统计使用当前 HEAD 可达提交的提交者时间，统计截至今日 00:00 UTC
          的完整自然日；日期切换只影响活动指标、趋势与排行。每个登记的工作区独立计数，同一提交存在于多个
          clone / worktree
          时会分别计入；不是跨项目去重的贡献统计。浅克隆与读取上限会标注历史不完整。
        </p>
        <p>
          主要语言按 Git 索引中已跟踪文件的扩展名数量识别，排除常见生成物和
          vendor；未识别与读取失败单独显示。状态缓存有效期 60 秒，统计缓存 5
          分钟。缓存过期或请求失败不作为干净、已同步或零提交。采集不执行 fetch / pull /
          push，待推送与待拉取仅相对本地远端跟踪引用。
        </p>
      </details>
      <AluneModal
        open={!!detail}
        title={detail?.title || '仓库明细'}
        description={`当前来源及搜索范围 · ${days} 天活动 · 当前工作区状态`}
        size="xl"
        body="scroll"
        hints={false}
        focusTriggerAfterClose={false}
        afterClose={() => restoreFocus(detailTrigger.current)}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
      >
        <RepositoryRows
          onRetry={retry}
          busy={busy}
          key={detail?.title}
          rows={detail ? rows.filter(detail.match) : []}
          sourceName={sourceName}
        />
      </AluneModal>
      <AluneModal
        open={trendOpen}
        title="逐日提交明细"
        description={`${activityNote} · UTC · 上一等长周期逐日对齐`}
        size="lg"
        body="scroll"
        hints={false}
        focusTriggerAfterClose={false}
        afterClose={() => {
          if (!detail) restoreFocus(trendTrigger.current);
        }}
        onCancel={() => setTrendOpen(false)}
        footer={<Button onClick={() => setTrendOpen(false)}>关闭</Button>}
      >
        <table className="collection-table">
          <thead>
            <tr>
              <th scope="col">本期日期</th>
              <th scope="col">提交</th>
              <th scope="col">上期日期</th>
              <th scope="col">提交</th>
              <th scope="col">仓库</th>
            </tr>
          </thead>
          <tbody>
            {current.map((value, i) => (
              <tr key={i}>
                <th scope="row">{overview.dates[i]}</th>
                <td>{value}</td>
                <td>{overview.previousDates[i]}</td>
                <td>{previous[i]}</td>
                <td>
                  <button
                    type="button"
                    className="overview-link"
                    onClick={() => {
                      setTrendOpen(false);
                      open(`${overview.dates[i]} 的活跃仓库`, (row) => (row.current?.[i] || 0) > 0);
                    }}
                  >
                    查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AluneModal>
    </div>
  );
}
