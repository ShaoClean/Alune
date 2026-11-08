import { ProtocolError } from '@alune/protocol';
import type { LogEntry, LogLevel, LoggingSettings, SaveLoggingSettings } from '@alune/protocol';

export const loggingApi = {
  settings: (): Promise<LoggingSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 loggingApi.settings。')),
  save: (_input: SaveLoggingSettings): Promise<LoggingSettings> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 loggingApi.save。')),
  recent: (_limit: number): Promise<LogEntry[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 loggingApi.recent。')),
  report: (_level: LogLevel, _message: string, _context?: Record<string, unknown>): Promise<any> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 loggingApi.report。')),
};

export function loggingError(error: unknown, fallback: string) {
  if (error instanceof ProtocolError) return error.message;
  return fallback;
}

interface LogBridge {
  openWindow(): Promise<void>;
  openDirectory(): Promise<string>;
  chooseDirectory(): Promise<string | null>;
}

declare global {
  interface Window {
    aluneLogs?: LogBridge;
  }
}

export const logBridge = (): LogBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.aluneLogs;

/** Desktop: standalone window. Web: a named tab so repeated clicks reuse it. */
export function openLogViewer() {
  const bridge = logBridge();
  if (bridge) return bridge.openWindow();
  window.open('/logs', 'alune-logs');
  return Promise.resolve();
}
