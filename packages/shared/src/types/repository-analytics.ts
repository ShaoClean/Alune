/** UTC complete calendar days; each registered working tree is one independent unit. */
export const ANALYTICS_DAY_MS = 86_400_000;
export const ANALYTICS_CACHE_MS = 300_000;
export const ANALYTICS_BATCH_SIZE = 20;
export interface RepositoryAnalytics {
  /** Exclusive UTC midnight, ISO date (YYYY-MM-DD). */
  endDay: string;
  /** Oldest to newest, 180 complete UTC days. */
  daily: number[];
  shallow: boolean;
  truncated: boolean;
  unborn: boolean;
  language: string | null;
  languageError?: string;
  sampledFiles: number;
  collectedAt: number;
}
export interface RepositoryAnalyticsEntry {
  id: string;
  data?: RepositoryAnalytics;
  error?: string;
}
