export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** One JSON Lines record; `context` is already redacted and size-limited. */
export interface LogEntry {
  time: string;
  level: LogLevel;
  source: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface LoggingSettings {
  /** Directory currently being written to. */
  directory: string;
  defaultDirectory: string;
  /** Saved custom directory; null uses the default. */
  customDirectory: string | null;
  level: LogLevel;
  retentionDays: number;
  maxTotalMB: number;
  /** Set when the saved custom directory is unusable and the default is in use. */
  fallbackReason?: string;
}

export interface SaveLoggingSettings {
  customDirectory: string | null;
  level: LogLevel;
  retentionDays: number;
  maxTotalMB: number;
}

export const LOGGING_LIMITS = {
  retentionDays: { min: 1, max: 365, default: 14 },
  maxTotalMB: { min: 20, max: 10240, default: 200 },
  fileMB: 20,
  history: 1000,
} as const;
