import { loggingApi } from '../api/logging';

const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

function report(message: string, context: Record<string, unknown>) {
  const key = `${message}\n${String(context.stack || '').slice(0, 200)}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - DEDUPE_MS) return;
  recent.set(key, now);
  if (recent.size > 100) recent.delete(recent.keys().next().value!);
  // Reporting must never raise another error.
  void loggingApi
    .report('ERROR', message, { ...context, page: window.location.pathname })
    .catch(() => {});
}

function describe(reason: unknown) {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack };
  return { message: typeof reason === 'string' ? reason : '未知错误' };
}

/** Sends uncaught renderer errors to the local log; installed once per page. */
export function installClientErrorReporting() {
  const onError = (event: ErrorEvent) => {
    const { message, stack } = describe(event.error ?? event.message);
    report(`前端未捕获异常：${message}`, {
      stack,
      ...(event.filename ? { file: event.filename, line: event.lineno } : {}),
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const { message, stack } = describe(event.reason);
    report(`前端未处理的 Promise 拒绝：${message}`, { stack });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
