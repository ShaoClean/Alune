import type { LogEntry } from '@alune/protocol';

/** A bounded recent-history cursor, independent of the transport connection. */
export class LogHistoryCursor {
  private owner?: string;
  private previous: string[] = [];

  take(agentId: string, next: LogEntry[]): LogEntry[] {
    const keys = next.map((entry) => JSON.stringify([
      entry.time, entry.level, entry.source, entry.message, entry.context ?? null,
    ]));
    const old = this.owner === agentId ? this.previous : [];
    let overlap = Math.min(old.length, keys.length);
    while (overlap && !old.slice(-overlap).every((key, i) => key === keys[i])) overlap--;
    this.owner = agentId;
    this.previous = keys;
    return next.slice(overlap);
  }
}
