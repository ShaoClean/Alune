import type { LogLevel } from '@alune/protocol';
import type { TraceHttp } from '../../ports/provider-http';

type Context = Record<string, unknown>;
type Writer = (level: LogLevel, source: string, message: string, context?: Context) => void;

export function errorContext(error: unknown): Context {
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

/** Request metadata only; the owning kernel supplies its private, redacting log store. */
export function createHttpTracer(write: Writer): TraceHttp {
  const record: Writer = (...args) => {
    try {
      write(...args);
    } catch {
      // Diagnostics must not replace a transport result or cause a request retry.
    }
  };
  return async (source, method, url, context, send) => {
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
      record(
        response.ok ? 'INFO' : 'WARN',
        source,
        response.ok ? `${method} ${target}` : `${method} ${target} 返回 HTTP ${response.status}`,
        details,
      );
      return response;
    } catch (error) {
      record('WARN', source, `${method} ${target} 请求失败`, {
        ...context,
        durationMs: Math.round(performance.now() - started),
        ...errorContext(error),
      });
      throw error;
    }
  };
}
