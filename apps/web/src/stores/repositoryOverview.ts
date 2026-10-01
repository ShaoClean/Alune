import { ANALYTICS_CACHE_MS, ANALYTICS_DAY_MS, REPOSITORY_STATUS_CACHE_MS } from '@alune/shared';
import type { Repository, RepositoryAnalyticsEntry } from '@alune/shared';
import type { RepositoryStatusEntry } from './repositoryStore';
import { repositoryGroupId } from './repositorySource';

export type WorkspaceState = 'clean' | 'dirty' | 'unknown';
export type OverviewRow = ReturnType<typeof overviewRow>;

export function overviewRow(
  repo: Repository,
  status: RepositoryStatusEntry | undefined,
  entry: RepositoryAnalyticsEntry | undefined,
  days: number,
  now: number,
) {
  const freshStatus = Boolean(
    status?.data &&
    !status.stale &&
    status.phase !== 'error' &&
    status.updatedAt !== undefined &&
    now - status.updatedAt < REPOSITORY_STATUS_CACHE_MS,
  );
  const data = freshStatus ? status!.data : undefined;
  const state: WorkspaceState = data ? (data.files.length ? 'dirty' : 'clean') : 'unknown';
  const endDay = new Date(now).toISOString().slice(0, 10);
  const freshAnalytics = Boolean(
    entry?.data &&
    !entry.error &&
    entry.data.endDay === endDay &&
    now - entry.data.collectedAt < ANALYTICS_CACHE_MS,
  );
  const analytics = freshAnalytics ? entry!.data : undefined;
  const current = analytics?.daily.slice(-days);
  const previous = analytics?.daily.slice(-days * 2, -days);
  const sum = (values?: number[]) => values?.reduce((a, b) => a + b, 0);
  return {
    repo,
    source: repositoryGroupId(repo),
    state,
    status: data,
    statusEntry: status,
    analyticsEntry: entry,
    analytics,
    current,
    previous,
    commits: sum(current),
    previousCommits: sum(previous),
    limited: Boolean(analytics?.shallow || analytics?.truncated),
    language: analytics
      ? analytics.languageError
        ? '读取失败'
        : analytics.language || '未识别'
      : '待采集',
    ahead: Boolean(data?.upstream && data.ahead > 0),
    behind: Boolean(data?.upstream && data.behind > 0),
    changedFiles: new Set(data?.files.map((file) => file.path) || []).size,
  };
}

export function buildRepositoryOverview(
  repositories: Repository[],
  statuses: Record<string, RepositoryStatusEntry>,
  analytics: Record<string, RepositoryAnalyticsEntry>,
  days: number,
  now = Date.now(),
) {
  const rows = repositories.map((repo) =>
    overviewRow(repo, statuses[repo.id], analytics[repo.id], days, now),
  );
  const collected = rows.filter((row) => row.analytics);
  const current = Array.from({ length: days }, (_, i) =>
    collected.reduce((n, row) => n + row.current![i], 0),
  );
  const previous = Array.from({ length: days }, (_, i) =>
    collected.reduce((n, row) => n + row.previous![i], 0),
  );
  const states = (['clean', 'dirty', 'unknown'] as const).map((state) => ({
    state,
    rows: rows.filter((row) => row.state === state),
  }));
  const sources = [...new Set(rows.map((row) => row.source))].map((source) => ({
    source,
    rows: rows.filter((row) => row.source === source),
  }));
  const languages = [...new Set(rows.map((row) => row.language))]
    .map((language) => ({ language, rows: rows.filter((row) => row.language === language) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.language.localeCompare(b.language));
  const commits = current.reduce((a, b) => a + b, 0);
  const previousCommits = previous.reduce((a, b) => a + b, 0);
  const end = Math.floor(now / ANALYTICS_DAY_MS) * ANALYTICS_DAY_MS;
  return {
    rows,
    collected,
    current,
    previous,
    states,
    sources,
    languages,
    commits,
    previousCommits,
    activityComplete: collected.length === rows.length && !rows.some((row) => row.limited),
    dates: current.map((_, i) =>
      new Date(end - (days - i) * ANALYTICS_DAY_MS).toISOString().slice(0, 10),
    ),
    previousDates: current.map((_, i) =>
      new Date(end - (2 * days - i) * ANALYTICS_DAY_MS).toISOString().slice(0, 10),
    ),
    active: rows.filter((row) => (row.commits || 0) > 0),
    syncedPending: rows.filter((row) => row.ahead || row.behind),
    ranking: [...collected]
      .filter((row) => row.commits! > 0)
      .sort((a, b) => b.commits! - a.commits! || a.repo.id.localeCompare(b.repo.id))
      .slice(0, 5),
  };
}

export function syncLabel(row: OverviewRow) {
  const status = row.status;
  if (!status) return '同步待确认';
  if (status.unborn) return '未首次提交';
  if (!status.branch || status.branch === 'HEAD') return '游离 HEAD';
  if (!status.upstream) return '无上游';
  return row.ahead || row.behind
    ? `待推送 ${status.ahead} / 待拉取 ${status.behind}`
    : '已同步（本地跟踪引用）';
}
