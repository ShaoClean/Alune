import {
  REPOSITORY_FOREGROUND_STATUS_TIMEOUT_MS,
  REPOSITORY_STATUS_TIMEOUT_MS,
} from '@alune/domain';
import { ProtocolError } from '@alune/protocol';

export function invalidatedRepositoryRead(resourceId: string) {
  return new ProtocolError('conflict', 'Repository changed during read', 'not-started', {
    code: 'READ_INVALIDATED',
    resourceId,
  });
}
interface Flight<T> {
  promise: Promise<T>;
  controller: AbortController;
  consumers: number;
  promote(): void;
}
/** Coalesce status reads without making one subscriber own another's cancellation. */
export class RepositoryReads {
  private owned = new Set<Promise<unknown>>();
  private active = new Map<string, Flight<unknown>>();
  private generations = new Map<string, number>();
  generation(key: string) {
    return this.generations.get(key) ?? 0;
  }
  invalidate(key: string) {
    this.generations.set(key, this.generation(key) + 1);
    const pending = this.active.get(key);
    this.active.delete(key);
    pending?.controller.abort(invalidatedRepositoryRead(key));
    return this.generation(key);
  }
  async status<T>(
    key: string,
    foreground: boolean,
    signal: AbortSignal,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    let flight = this.active.get(key) as Flight<T> | undefined;
    if (!flight) {
      if (this.owned.size >= 64) throw new ProtocolError('overloaded', 'Too many repository reads');
      const controller = new AbortController();
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout>;
      const schedule = () => {
        clearTimeout(timer);
        const limit = foreground
          ? REPOSITORY_FOREGROUND_STATUS_TIMEOUT_MS
          : REPOSITORY_STATUS_TIMEOUT_MS;
        timer = setTimeout(
          () => controller.abort(new ProtocolError('timeout', 'Repository status timed out')),
          Math.max(0, limit - (Date.now() - started)),
        );
        timer.unref();
      };
      schedule();
      flight = {
        controller,
        consumers: 0,
        promote() {
          foreground = true;
          schedule();
        },
        promise: Promise.resolve()
          .then(() => run(controller.signal))
          .finally(() => {
            clearTimeout(timer);
            this.owned.delete(flight!.promise);
            if (this.active.get(key) === flight) this.active.delete(key);
          }),
      };
      // Attach before the first subscriber so immediate cancellation cannot leak a rejection.
      void flight.promise.catch(() => {});
      this.active.set(key, flight);
      this.owned.add(flight.promise);
    } else if (foreground) flight.promote();
    const entry = flight;
    entry.consumers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal.removeEventListener('abort', cancel);
        entry.consumers--;
        return true;
      };
      const cancel = () => {
        if (!finish()) return;
        reject(signal.reason);
        if (!entry.consumers) {
          if (this.active.get(key) === entry) this.active.delete(key);
          entry.controller.abort(signal.reason);
        }
      };
      signal.addEventListener('abort', cancel, { once: true });
      entry.promise.then(
        (v) => {
          if (finish()) resolve(v);
        },
        (e) => {
          if (finish()) reject(e);
        },
      );
      if (signal.aborted) cancel();
    });
  }
  async close() {
    const pending = [...this.active.values()];
    for (const entry of pending)
      entry.controller.abort(new ProtocolError('cancelled', 'Agent session closed'));
    await Promise.allSettled(this.owned);
    this.active.clear();
    this.generations.clear();
  }
}
