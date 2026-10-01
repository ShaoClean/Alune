import { BadRequestException, Injectable } from '@nestjs/common';
import { ANALYTICS_BATCH_SIZE, ANALYTICS_CACHE_MS } from '@alune/shared';
import type { Repository, RepositoryAnalyticsEntry } from '@alune/shared';
import { collectRepositoryAnalytics } from '@alune/ssh-client';
import { RepositoryService } from './repository.service';

type Job = { source: string; run: () => Promise<void> };

@Injectable()
export class RepositoryAnalyticsService {
  private cache = new Map<string, RepositoryAnalyticsEntry>();
  private pending = new Map<string, Promise<RepositoryAnalyticsEntry>>();
  private failures = new Map<string, number>();
  private queue: Job[] = [];
  private sources = new Set<string>();
  private active = 0;

  constructor(private readonly repositories: RepositoryService) {}

  async batch(body: { ids?: unknown; collect?: unknown; refresh?: unknown }) {
    if (
      !body ||
      !Array.isArray(body.ids) ||
      body.ids.length > ANALYTICS_BATCH_SIZE ||
      body.ids.some((id) => typeof id !== 'string' || !id || id.length > 100) ||
      (body.collect !== undefined && typeof body.collect !== 'boolean') ||
      (body.refresh !== undefined && typeof body.refresh !== 'boolean')
    )
      throw new BadRequestException('统计请求最多包含 20 个有效仓库 ID');
    const endDay = new Date().toISOString().slice(0, 10);
    const registry = new Map(
      (await this.repositories.list()).map((repo) => [repo.id, repo]),
    );
    // Bound memory to 1000 summaries and discard removed registrations.
    for (const id of this.cache.keys())
      if (!registry.has(id)) this.cache.delete(id);
    return Promise.all(
      [...new Set(body.ids as string[])].map(async (id) => {
        const repo = registry.get(id);
        if (!repo) return { id, error: '仓库已移除，请刷新列表' };
        const cached = this.cache.get(id);
        if (!body.collect) return cached || { id };
        if (
          !body.refresh &&
          cached?.data?.endDay === endDay &&
          !cached.error &&
          Date.now() - cached.data.collectedAt < ANALYTICS_CACHE_MS
        )
          return cached;
        const existing = this.pending.get(id);
        if (existing) return existing;
        if (this.queue.length >= 40)
          return { id, error: '统计队列已满，请稍后重试' };
        const source =
          repo.source === 'local'
            ? `local:${id}`
            : repo.connectionId || '@unknown';
        const request = new Promise<RepositoryAnalyticsEntry>((resolve) => {
          this.queue.push({
            source,
            run: async () => {
              const result = await this.collect(repo, endDay, source);
              this.cache.delete(id);
              this.cache.set(id, result);
              while (this.cache.size > 1000)
                this.cache.delete(this.cache.keys().next().value!);
              resolve(result);
            },
          });
        }).finally(() => this.pending.delete(id));
        this.pending.set(id, request);
        this.drain();
        return request;
      }),
    );
  }

  private drain() {
    while (this.active < 3) {
      const index = this.queue.findIndex(
        (job) => !this.sources.has(job.source),
      );
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      this.active++;
      this.sources.add(job.source);
      void job.run().finally(() => {
        this.active--;
        this.sources.delete(job.source);
        this.drain();
      });
    }
  }

  private async collect(
    repo: Repository,
    endDay: string,
    source: string,
  ): Promise<RepositoryAnalyticsEntry> {
    if ((this.failures.get(source) || 0) > Date.now())
      return {
        id: repo.id,
        data: this.cache.get(repo.id)?.data,
        error: '此 SSH 来源暂不可用，30 秒后可重试',
      };
    const controller = new AbortController();
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.failures.delete(source);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('统计采集超时（10 秒），请重试');
          controller.abort(error);
          reject(error);
        }, 10000);
      });
      const work = (async () => {
        const connection = await this.repositories.connection(
          repo,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        connected = true;
        return collectRepositoryAnalytics(
          connection,
          repo.path,
          endDay,
          controller.signal,
        );
      })();
      return { id: repo.id, data: await Promise.race([work, timeout]) };
    } catch (error) {
      if (!connected && repo.source !== 'local') {
        // One unreachable host must not cost another timeout for each of its repositories.
        for (const [key, until] of this.failures)
          if (until <= Date.now()) this.failures.delete(key);
        if (this.failures.size >= 1000)
          this.failures.delete(this.failures.keys().next().value!);
        this.failures.set(source, Date.now() + 30000);
      }
      return {
        id: repo.id,
        data: this.cache.get(repo.id)?.data,
        error: error instanceof Error ? error.message : '统计读取失败',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
