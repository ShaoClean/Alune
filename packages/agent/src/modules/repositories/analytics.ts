import { ANALYTICS_CACHE_MS, type RepositoryAnalytics, type ResourceRef } from '@alune/domain';
import { ProtocolError } from '@alune/protocol';
import { RepositoryReads } from '../../runtime/reads';

export type AnalyticsEntry = {
  id: string;
  resource: ResourceRef;
  data?: RepositoryAnalytics;
  error?: string;
};
/** Bounded host-local analytics scheduling, cache and per-consumer cancellation. */
export class RepositoryAnalyticsCache {
  private cache = new Map<string, AnalyticsEntry>();
  private reads = new RepositoryReads();
  private active = 0;
  private queue: Array<() => void> = [];
  private closed = false;
  constructor(
    private readonly collect: (
      resource: ResourceRef,
      endDay: string,
      signal: AbortSignal,
    ) => Promise<RepositoryAnalytics>,
  ) {}
  invalidate(id: string) {
    this.cache.delete(id);
    this.reads.invalidate(id);
  }
  async batch(
    resources: ResourceRef[],
    collect: boolean,
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<AnalyticsEntry[]> {
    const endDay = new Date().toISOString().slice(0, 10);
    return Promise.all(
      resources.map(async (resource) => {
        const id = resource.resourceId;
        const cached = this.cache.get(id);
        if (!collect) return cached ?? { id, resource };
        if (
          !refresh &&
          cached?.data?.endDay === endDay &&
          !cached.error &&
          Date.now() - cached.data.collectedAt < ANALYTICS_CACHE_MS
        )
          return cached;
        const generation = this.reads.generation(id);
        try {
          const value = await this.reads.status(id, false, signal, (taskSignal) =>
            this.schedule(async () => {
              taskSignal.throwIfAborted();
              return this.collect(resource, endDay, taskSignal);
            }),
          );
          signal.throwIfAborted();
          if (this.reads.generation(id) !== generation)
            throw new ProtocolError('conflict', 'Repository analytics changed');
          const entry = { id, resource, data: value };
          this.cache.delete(id);
          this.cache.set(id, entry);
          while (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
          return entry;
        } catch (error) {
          signal.throwIfAborted();
          return {
            id,
            resource,
            ...(cached?.data ? { data: cached.data } : {}),
            error: error instanceof Error ? error.message : '统计读取失败',
          };
        }
      }),
    );
  }
  private schedule<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ProtocolError('cancelled', 'Analytics closed'));
    if (this.queue.length >= 40)
      return Promise.reject(new ProtocolError('overloaded', '统计队列已满，请稍后重试'));
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++;
        void Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
      };
      if (this.active < 3) start();
      else this.queue.push(start);
    });
  }
  async close() {
    this.closed = true;
    await this.reads.close();
    this.cache.clear();
  }
}
