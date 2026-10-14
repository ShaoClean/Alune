import axios from 'axios';
import type { LogEntry, LogLevel, LoggingSettings, SaveLoggingSettings } from '@alune/shared';

const api = axios.create({ baseURL: '/api/logs', timeout: 15_000 });

export const loggingApi = {
  settings: (): Promise<LoggingSettings> => api.get('/settings').then((response) => response.data),
  save: (input: SaveLoggingSettings): Promise<LoggingSettings> =>
    api.put('/settings', input).then((response) => response.data),
  recent: (limit: number): Promise<LogEntry[]> =>
    api.get('/recent', { params: { limit } }).then((response) => response.data),
  report: (level: LogLevel, message: string, context?: Record<string, unknown>) =>
    api.post('/client', { level, message, context }).then(() => undefined),
};

export function loggingError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === 'string')
    return error.response.data.message as string;
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
