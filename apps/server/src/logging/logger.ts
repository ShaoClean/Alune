import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogLevel } from '@alune/shared';
import { LogStore } from './log-store';

export type LogContext = Record<string, unknown>;

let store: LogStore | undefined;

/**
 * One store per process. The desktop main process and the embedded Nest server
 * share it, so both write the same files and feed the same live stream.
 */
export function logStore(): LogStore {
  if (!store) {
    const directory =
      process.env.ALUNE_DATA_DIR ||
      // Unit tests without an isolated data directory must not touch ~/.alune.
      (process.env.NODE_ENV === 'test'
        ? join(tmpdir(), `alune-test-logs-${process.pid}`)
        : join(homedir(), '.alune'));
    store = new LogStore(directory);
    process.once('exit', () => store?.flush());
  }
  return store;
}

/** Test hook: replace or reset the process-wide store. */
export function setLogStore(next: LogStore | undefined) {
  store?.close();
  store = next;
}

function write(
  level: LogLevel,
  source: string,
  message: string,
  context?: LogContext,
) {
  try {
    logStore().write(level, source, message, context);
  } catch {}
}

export const logger = {
  debug: (source: string, message: string, context?: LogContext) =>
    write('DEBUG', source, message, context),
  info: (source: string, message: string, context?: LogContext) =>
    write('INFO', source, message, context),
  warn: (source: string, message: string, context?: LogContext) =>
    write('WARN', source, message, context),
  error: (source: string, message: string, context?: LogContext) =>
    write('ERROR', source, message, context),
  enabled: (level: LogLevel) => {
    try {
      return logStore().enabled(level);
    } catch {
      return false;
    }
  },
};

export function errorContext(error: unknown): LogContext {
  if (error instanceof Error)
    return {
      error: {
        name: error.name,
        message: error.message,
        ...((error as NodeJS.ErrnoException).code
          ? { code: (error as NodeJS.ErrnoException).code }
          : {}),
        ...(error.stack ? { stack: error.stack } : {}),
      },
    };
  return { error: String(error) };
}

/** Logs an outgoing HTTP request: method, host and path only (no query, headers or body). */
export async function traceHttp(
  source: string,
  method: string,
  url: string | URL,
  context: LogContext,
  send: () => Promise<Response>,
): Promise<Response> {
  let target: string;
  try {
    const parsed = new URL(url);
    target = `${parsed.host}${parsed.pathname}`;
  } catch {
    target = '[invalid url]';
  }
  const started = performance.now();
  try {
    const response = await send();
    const details = {
      ...context,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    };
    if (response.ok) logger.info(source, `${method} ${target}`, details);
    else
      logger.warn(
        source,
        `${method} ${target} 返回 HTTP ${response.status}`,
        details,
      );
    return response;
  } catch (error) {
    logger.warn(source, `${method} ${target} 请求失败`, {
      ...context,
      durationMs: Math.round(performance.now() - started),
      ...errorContext(error),
    });
    throw error;
  }
}
