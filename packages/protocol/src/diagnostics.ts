import { isRecord, ProtocolError, validId } from './messages';
import { LOG_LEVELS, LOGGING_LIMITS, type LogEntry, type LoggingSettings } from './legacy/logging';

export type LogSettingsResult = { revision: string; settings: LoggingSettings };
export type LogSnapshot = { snapshotId: string; chunks: number; bytes: number; entries: number };
export type LogChunk = { snapshotId: string; index: number; base64: string };
function invalid(): never {
  throw new ProtocolError('invalid-request', 'Invalid diagnostics response');
}
const string = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.length <= maximum && !value.includes('\0');
export function validateLogSettingsResult(value: unknown): LogSettingsResult {
  if (!isRecord(value) || !validId(value.revision) || !isRecord(value.settings)) invalid();
  const settings = value.settings;
  if (
    !string(settings.directory, 32768) ||
    !string(settings.defaultDirectory, 32768) ||
    (settings.customDirectory !== null && !string(settings.customDirectory, 32768)) ||
    !LOG_LEVELS.includes(settings.level as any) ||
    !Number.isInteger(settings.retentionDays) ||
    Number(settings.retentionDays) < LOGGING_LIMITS.retentionDays.min ||
    Number(settings.retentionDays) > LOGGING_LIMITS.retentionDays.max ||
    !Number.isInteger(settings.maxTotalMB) ||
    Number(settings.maxTotalMB) < LOGGING_LIMITS.maxTotalMB.min ||
    Number(settings.maxTotalMB) > LOGGING_LIMITS.maxTotalMB.max ||
    (settings.fallbackReason !== undefined && !string(settings.fallbackReason, 4000)) ||
    Object.keys(settings).some(
      (key) =>
        ![
          'directory',
          'defaultDirectory',
          'customDirectory',
          'level',
          'retentionDays',
          'maxTotalMB',
          'fallbackReason',
        ].includes(key),
    )
  )
    invalid();
  return value as unknown as LogSettingsResult;
}
export function validateLogSnapshot(value: unknown): LogSnapshot {
  if (
    !isRecord(value) ||
    !validId(value.snapshotId) ||
    !Number.isInteger(value.bytes) ||
    Number(value.bytes) < 2 ||
    Number(value.bytes) > 16 * 1024 * 1024 ||
    value.chunks !== Math.ceil(Number(value.bytes) / 32768) ||
    !Number.isInteger(value.entries) ||
    Number(value.entries) < 0 ||
    Number(value.entries) > 1000
  )
    invalid();
  return value as LogSnapshot;
}
export function validateLogChunk(value: unknown): LogChunk {
  if (
    !isRecord(value) ||
    !validId(value.snapshotId) ||
    !Number.isInteger(value.index) ||
    Number(value.index) < 0 ||
    typeof value.base64 !== 'string' ||
    !value.base64 ||
    value.base64.length > 43692 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)
  )
    invalid();
  return value as LogChunk;
}
export function validateLogEntries(value: unknown): LogEntry[] {
  if (!Array.isArray(value) || value.length > 1000) invalid();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.time !== 'string' ||
      !Number.isFinite(Date.parse(entry.time)) ||
      !LOG_LEVELS.includes(entry.level as any) ||
      !string(entry.source, 64) ||
      !string(entry.message, 4100) ||
      (entry.context !== undefined && !isRecord(entry.context)) ||
      Object.keys(entry).some(
        (key) => !['time', 'level', 'source', 'message', 'context'].includes(key),
      )
    )
      invalid();
  }
  return value as LogEntry[];
}
