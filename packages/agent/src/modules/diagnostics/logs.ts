import { randomUUID } from 'node:crypto';
import {
  isRecord,
  ProtocolError,
  validateEmpty,
  type JsonValue,
  type LogLevel,
} from '@alune/protocol';
import { LogStore, LogValidationError, validateLoggingSettings } from '../../adapters/logging';
import type { JsonDocument } from '../../ports/state';
import { StateFault } from '../../ports/state';
import type { EventPublisher, Handler } from '../../ports/handler';

const CHUNK_BYTES = 32768;
const SNAPSHOT_BYTES = 16 * 1024 * 1024;
const CACHE_BYTES = SNAPSHOT_BYTES * 2;
const TTL = 60000;

export function diagnosticLogs(directory: string, document: JsonDocument) {
  let revision: string = randomUUID();
  let corrupt = false;
  const port: JsonDocument = {
    read() {
      const value = document.read();
      if (value === undefined) return undefined;
      if (
        !isRecord(value) ||
        typeof value.revision !== 'string' ||
        !value.revision ||
        !isRecord(value.settings)
      ) {
        corrupt = true;
        throw new StateFault('corrupt', 'Invalid logging configuration');
      }
      revision = value.revision;
      try {
        return validateLoggingSettings(value.settings);
      } catch (error) {
        corrupt = true;
        throw error;
      }
    },
    write(value) {
      const next = randomUUID();
      document.write({ revision: next, settings: value });
      revision = next;
    },
  };
  const logs = new LogStore(directory, () => new Date(), port);
  let publisher: EventPublisher | undefined;
  const unsubscribe = logs.subscribe(() =>
    publisher?.notifyState('diagnostics.logs.changed', { changed: true }),
  );
  const snapshots = new Map<string, { data: Buffer; expires: number }>();
  let cacheBytes = 0;
  function release(id: string) {
    const item = snapshots.get(id);
    if (item) {
      cacheBytes -= item.data.length;
      snapshots.delete(id);
    }
  }
  function expire() {
    for (const [id, value] of snapshots) if (value.expires <= Date.now()) release(id);
  }
  const timer = setInterval(expire, TTL);
  timer.unref();
  let window = { start: 0, count: 0, dropped: 0 };
  function shape(
    value: unknown,
    required: string[],
    optional: string[] = [],
  ): asserts value is Record<string, JsonValue> {
    if (
      !isRecord(value) ||
      required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
    )
      throw new ProtocolError('invalid-params', 'Invalid diagnostics parameters');
  }
  function handler(
    effect: 'query' | 'mutation',
    validate: Handler['validate'],
    run: (params: any) => unknown,
  ): Handler {
    return {
      minimumProtocolMinor: 1,
      effect,
      validate(params) {
        try {
          validate(params);
        } catch (error) {
          if (error instanceof LogValidationError)
            throw new ProtocolError('invalid-params', error.message);
          throw error;
        }
      },
      run(params, context) {
        context.signal.throwIfAborted();
        publisher = context.events;
        try {
          return run(params) as JsonValue;
        } catch (error) {
          if (error instanceof LogValidationError)
            throw new ProtocolError('invalid-params', error.message);
          throw error;
        }
      },
    };
  }
  const handlers: Record<string, Handler> = {
    'diagnostics.logs.settings': handler('query', validateEmpty, () => ({
      revision,
      settings: logs.settings(),
    })),
    'diagnostics.logs.saveSettings': handler(
      'mutation',
      (p) => {
        shape(p, ['revision', 'settings']);
        validateLoggingSettings(p.settings);
      },
      (p) => {
        if (corrupt)
          throw new StateFault(
            'corrupt',
            'Logging configuration is damaged; restore it before saving',
          );
        if (p.revision !== revision)
          throw new StateFault('conflict', 'Logging configuration changed; reload before saving');
        const settings = logs.update(p.settings);
        return { revision, settings };
      },
    ),
    'diagnostics.logs.snapshot': handler(
      'query',
      (p) => {
        shape(p, ['limit']);
        if (!Number.isInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 1000)
          throw new ProtocolError('invalid-params', 'Log limit must be 1–1000');
      },
      (p) => {
        expire();
        const entries = logs.recent(p.limit);
        const parts: Buffer[] = [Buffer.from('[')];
        let bytes = 2;
        for (const [index, entry] of entries.entries()) {
          const part = Buffer.from((index ? ',' : '') + JSON.stringify(entry));
          bytes += part.length;
          if (bytes > SNAPSHOT_BYTES)
            throw new ProtocolError(
              'overloaded',
              'Log snapshot is too large; request fewer entries',
            );
          parts.push(part);
        }
        parts.push(Buffer.from(']'));
        const data = Buffer.concat(parts);
        while (snapshots.size >= 4 || cacheBytes + data.length > CACHE_BYTES)
          release(snapshots.keys().next().value!);
        const snapshotId = randomUUID();
        snapshots.set(snapshotId, { data, expires: Date.now() + TTL });
        cacheBytes += data.length;
        return {
          snapshotId,
          chunks: Math.ceil(data.length / CHUNK_BYTES),
          bytes: data.length,
          entries: entries.length,
        };
      },
    ),
    'diagnostics.logs.chunk': handler(
      'query',
      (p) => {
        shape(p, ['snapshotId', 'index']);
        if (
          typeof p.snapshotId !== 'string' ||
          p.snapshotId.length > 100 ||
          !Number.isInteger(p.index) ||
          Number(p.index) < 0
        )
          throw new ProtocolError('invalid-params', 'Invalid log chunk');
      },
      (p) => {
        expire();
        const item = snapshots.get(p.snapshotId);
        if (!item)
          throw new StateFault('not-found', 'Log snapshot expired; request a fresh snapshot');
        const start = p.index * CHUNK_BYTES;
        if (start >= item.data.length)
          throw new ProtocolError('invalid-params', 'Log chunk index is out of range');
        return {
          snapshotId: p.snapshotId,
          index: p.index,
          base64: item.data.subarray(start, start + CHUNK_BYTES).toString('base64'),
        };
      },
    ),
    'diagnostics.logs.release': handler(
      'query',
      (p) => {
        shape(p, ['snapshotId']);
        if (typeof p.snapshotId !== 'string' || p.snapshotId.length > 100)
          throw new ProtocolError('invalid-params', 'Invalid log snapshot');
      },
      (p) => {
        release(p.snapshotId);
        return { released: true };
      },
    ),
    'diagnostics.logs.client': handler(
      'mutation',
      (p) => {
        shape(p, ['message'], ['level', 'context']);
        if (Buffer.byteLength(JSON.stringify(p)) > 1024 * 1024)
          throw new ProtocolError(
            'invalid-params',
            'Client log exceeds the existing 1 MiB input limit',
          );
        if (typeof p.message !== 'string' || !p.message)
          throw new ProtocolError('invalid-params', 'Log message is required');
      },
      (p) => {
        const now = Date.now();
        if (now - window.start > 60000) {
          if (window.dropped)
            logs.write('WARN', 'client', `前端日志过多，已丢弃 ${window.dropped} 条`);
          window = { start: now, count: 0, dropped: 0 };
        }
        if (++window.count > 60) {
          window.dropped++;
          return { accepted: false };
        }
        const level: LogLevel = ['INFO', 'WARN', 'ERROR'].includes(p.level) ? p.level : 'ERROR';
        logs.write(
          level,
          'client',
          p.message.slice(0, 2000),
          isRecord(p.context) ? p.context : undefined,
        );
        return { accepted: true };
      },
    ),
  };
  // Rate-limited diagnostic writes must not grow the durable business journal
  // for every dropped renderer message. Their receipts are session-scoped.
  handlers['diagnostics.logs.client'].durable = false;
  return {
    logs,
    handlers,
    close() {
      clearInterval(timer);
      unsubscribe();
      snapshots.clear();
      cacheBytes = 0;
      publisher = undefined;
      logs.close();
    },
  };
}
