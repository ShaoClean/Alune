import type { Repository } from '@alune/domain';
import { isRecord, ProtocolError } from '@alune/protocol';
import type { BackgroundFetchResult } from '../api/agent-workspace';
import type { BackgroundFetchState } from '../stores/backgroundSyncStore';
import type { BackgroundSyncPreferences } from '../stores/workspaceStore';

const MINUTE = 60_000;
const CONCURRENCY = 2;

type Job = {
  repo: Repository;
  nextAt: number;
  failures: number;
  pauseReason?: string;
  checkedAt?: number;
};

function classifyFailure(error: unknown): Pick<BackgroundFetchState, 'phase' | 'reason'> {
  const reason = (error instanceof Error ? error.message : '无法获取远程更新。').slice(0, 360);
  if (error instanceof ProtocolError) {
    const code = isRecord(error.details) ? error.details.code : undefined;
    if (error.kind === 'busy' || (error.kind === 'conflict' && error.outcome === 'not-started'))
      return { phase: 'paused', reason: '仓库正在执行其他操作，稍后重试。' };
    if (
      error.kind === 'disconnected' ||
      code === 'PROXY_UNAVAILABLE' ||
      /could not resolve proxy|failed to connect to proxy|proxy tunnel failed/i.test(reason)
    )
      return { phase: 'paused', reason };
  }
  return { phase: 'error', reason };
}

export function createBackgroundFetchScheduler({
  fetch,
  report,
  completed,
}: {
  fetch: (repo: Repository, signal: AbortSignal) => Promise<BackgroundFetchResult>;
  report: (id: string, state?: BackgroundFetchState) => void;
  completed: (
    repo: Repository,
    result: BackgroundFetchResult,
    signal: AbortSignal,
  ) => Promise<void>;
}) {
  const jobs = new Map<string, Job>();
  const running = new Map<string, { controller: AbortController; hostId?: string }>();
  let interval = 10 * MINUTE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function available(job: Job) {
    return (
      !job.pauseReason &&
      !running.has(job.repo.id) &&
      (!job.repo.connectionId ||
        ![...running.values()].some((run) => run.hostId === job.repo.connectionId))
    );
  }

  function wake() {
    clearTimeout(timer);
    if (stopped) return;
    let next = Infinity;
    const now = Date.now();
    for (const job of [...jobs.values()].sort((left, right) => left.nextAt - right.nextAt)) {
      if (running.size >= CONCURRENCY) break;
      if (!available(job)) continue;
      if (job.nextAt <= now) start(job);
      else next = Math.min(next, job.nextAt);
    }
    if (running.size < CONCURRENCY && Number.isFinite(next))
      timer = setTimeout(wake, Math.max(0, next - Date.now()));
  }

  function start(job: Job) {
    const repo = job.repo;
    const controller = new AbortController();
    const signal = controller.signal;
    running.set(repo.id, { controller, hostId: repo.connectionId });
    if (job.checkedAt !== undefined)
      report(repo.id, { phase: 'fetching', checkedAt: job.checkedAt });
    else report(repo.id, { phase: 'fetching' });
    void (async () => {
      try {
        const result = await fetch(repo, signal);
        if (signal.aborted) return;
        job.failures = 0;
        job.checkedAt = Date.now();
        job.nextAt = job.checkedAt + interval;
        report(repo.id, {
          phase: result.fetched ? 'success' : 'paused',
          reason: result.fetched ? undefined : '仓库尚未配置远程地址。',
          checkedAt: job.checkedAt,
        });
        await completed(repo, result, signal);
      } catch (error) {
        if (signal.aborted) return;
        job.failures++;
        job.nextAt = Date.now() + Math.min(interval, MINUTE * 2 ** Math.min(job.failures - 1, 5));
        report(repo.id, { ...classifyFailure(error), checkedAt: job.checkedAt });
      } finally {
        running.delete(repo.id);
        wake();
      }
    })();
  }

  function remove(id: string) {
    running.get(id)?.controller.abort();
    jobs.delete(id);
    report(id);
  }

  return {
    reconcile(
      preferences: BackgroundSyncPreferences,
      repositories: readonly Repository[],
      getPauseReason: (repo: Repository) => string | undefined,
    ) {
      if (stopped) return;
      const nextInterval = preferences.intervalMinutes * MINUTE;
      const intervalChanged = interval !== nextInterval;
      interval = nextInterval;
      const excluded = new Set(preferences.excludedRepositoryIds);
      const eligible = new Map(
        (preferences.enabled ? repositories : [])
          .filter((repo) => !excluded.has(repo.id))
          .map((repo) => [repo.id, repo]),
      );
      for (const [id, job] of jobs) {
        const repo = eligible.get(id);
        if (!repo || repo.path !== job.repo.path || repo.connectionId !== job.repo.connectionId)
          remove(id);
      }
      for (const repo of eligible.values()) {
        let job = jobs.get(repo.id);
        if (!job) {
          job = { repo, nextAt: 0, failures: 0 };
          jobs.set(repo.id, job);
        }
        job.repo = repo;
        const pauseReason = getPauseReason(repo);
        if (pauseReason !== job.pauseReason) {
          job.pauseReason = pauseReason;
          job.nextAt = 0;
          if (pauseReason) {
            running.get(repo.id)?.controller.abort();
            report(repo.id, { phase: 'paused', reason: pauseReason, checkedAt: job.checkedAt });
          }
        } else if (intervalChanged) {
          if (job.failures) job.nextAt = Math.min(job.nextAt, Date.now() + interval);
          else if (job.checkedAt !== undefined) job.nextAt = job.checkedAt + interval;
        }
      }
      wake();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const id of jobs.keys()) remove(id);
    },
  };
}
