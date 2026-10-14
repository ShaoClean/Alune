import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  LOG_LEVELS,
  LOGGING_LIMITS,
  type LogEntry,
  type LogLevel,
  type LoggingSettings,
  type SaveLoggingSettings,
} from '@alune/shared';
import { redactContext, redactText } from './redact';

type Stored = SaveLoggingSettings;
type Listener = (entry: LogEntry) => void;

const FILE = /^alune-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;
const FLUSH_MS = 200;
const FLUSH_BYTES = 256 * 1024;
const HISTORY_BYTES = 2 * 1024 * 1024;
const CLEANUP_MS = 60 * 60_000;

const defaults = (): Stored => ({
  customDirectory: null,
  level: 'INFO',
  retentionDays: LOGGING_LIMITS.retentionDays.default,
  maxTotalMB: LOGGING_LIMITS.maxTotalMB.default,
});

export class LogValidationError extends Error {}

function integer(
  value: unknown,
  range: { min: number; max: number },
  label: string,
) {
  if (
    !Number.isInteger(value) ||
    (value as number) < range.min ||
    (value as number) > range.max
  )
    throw new LogValidationError(
      `${label}应为 ${range.min}–${range.max} 的整数。`,
    );
  return value as number;
}

export function validateLoggingSettings(input: unknown): Stored {
  const value = (input ?? {}) as Partial<Stored>;
  if (!LOG_LEVELS.includes(value.level as LogLevel))
    throw new LogValidationError('日志等级无效。');
  let customDirectory: string | null = null;
  if (value.customDirectory !== null && value.customDirectory !== undefined) {
    if (
      typeof value.customDirectory !== 'string' ||
      value.customDirectory.includes('\0')
    )
      throw new LogValidationError('日志目录无效。');
    const trimmed = value.customDirectory.trim();
    if (trimmed) {
      if (!isAbsolute(trimmed))
        throw new LogValidationError('日志目录必须是绝对路径。');
      customDirectory = resolve(trimmed);
    }
  }
  return {
    customDirectory,
    level: value.level as LogLevel,
    retentionDays: integer(
      value.retentionDays,
      LOGGING_LIMITS.retentionDays,
      '保留天数',
    ),
    maxTotalMB: integer(
      value.maxTotalMB,
      LOGGING_LIMITS.maxTotalMB,
      '总大小上限',
    ),
  };
}

/** Throws a user-facing message when the directory cannot hold log files. */
export function assertWritableDirectory(directory: string) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const probe = join(directory, `.alune-write-test-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new LogValidationError(
      code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
        ? `没有写入权限：${directory}`
        : code === 'ENOTDIR' || code === 'EEXIST'
          ? `路径不是目录：${directory}`
          : `无法写入日志目录：${directory}（${code || (error as Error).message}）`,
    );
  }
}

function localDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function listLogFiles(directory: string) {
  try {
    return readdirSync(directory)
      .map((name) => {
        const match = FILE.exec(name);
        if (!match) return null;
        try {
          const stats = statSync(join(directory, name));
          return stats.isFile()
            ? {
                name,
                path: join(directory, name),
                date: match[1],
                index: Number(match[2] || 0),
                size: stats.size,
              }
            : null;
        } catch {
          return null;
        }
      })
      .filter((file): file is NonNullable<typeof file> => Boolean(file))
      .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  } catch {
    return [];
  }
}

function readTail(path: string, bytes: number) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    // Drop a partial first line when the read started mid-file.
    return length < size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

export class LogStore {
  readonly defaultDirectory: string;
  private settingsFile: string;
  private stored: Stored = defaults();
  private active: string;
  private fallbackReason?: string;
  private pending: string[] = [];
  private pendingBytes = 0;
  private timer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private file?: { date: string; index: number; size: number; path: string };
  private history: LogEntry[] = [];
  private listeners = new Set<Listener>();
  private writing = false;
  private closed = false;

  constructor(
    dataDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.defaultDirectory = join(dataDirectory, 'logs');
    this.settingsFile = join(dataDirectory, 'logging.json');
    try {
      this.stored = validateLoggingSettings(
        JSON.parse(readFileSync(this.settingsFile, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.fallbackReason = '日志设置文件无法读取，已使用默认设置。';
    }
    this.active = this.resolveDirectory();
    this.loadHistory();
    this.cleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_MS);
    this.cleanupTimer.unref();
    if (this.fallbackReason) this.write('WARN', 'logging', this.fallbackReason);
  }

  private resolveDirectory() {
    if (this.stored.customDirectory) {
      try {
        assertWritableDirectory(this.stored.customDirectory);
        this.fallbackReason = undefined;
        return this.stored.customDirectory;
      } catch (error) {
        this.fallbackReason = `${(error as Error).message}；已回退到默认目录。`;
      }
    }
    try {
      mkdirSync(this.defaultDirectory, { recursive: true, mode: 0o700 });
    } catch {}
    return this.defaultDirectory;
  }

  settings(): LoggingSettings {
    return {
      directory: this.active,
      defaultDirectory: this.defaultDirectory,
      ...this.stored,
      ...(this.fallbackReason ? { fallbackReason: this.fallbackReason } : {}),
    };
  }

  update(input: unknown): LoggingSettings {
    const next = validateLoggingSettings(input);
    if (next.customDirectory) assertWritableDirectory(next.customDirectory);
    const temporary = `${this.settingsFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temporary, this.settingsFile);
    const previous = this.active;
    this.flush();
    this.stored = next;
    this.active = this.resolveDirectory();
    if (this.active !== previous) this.file = undefined;
    this.write('INFO', 'logging', '日志设置已更新', {
      directory: this.active,
      level: next.level,
      retentionDays: next.retentionDays,
      maxTotalMB: next.maxTotalMB,
    });
    this.cleanup();
    return this.settings();
  }

  enabled(level: LogLevel) {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(this.stored.level);
  }

  write(
    level: LogLevel,
    source: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    if (this.closed || !this.enabled(level)) return;
    const entry: LogEntry = {
      time: this.now().toISOString(),
      level,
      source: source.slice(0, 64),
      message: redactText(message),
    };
    const safe = redactContext(context);
    if (safe) entry.context = safe;
    const line = `${JSON.stringify(entry)}\n`;
    this.pending.push(line);
    this.pendingBytes += Buffer.byteLength(line);
    this.history.push(entry);
    if (this.history.length > LOGGING_LIMITS.history * 2)
      this.history.splice(0, this.history.length - LOGGING_LIMITS.history);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {}
    }
    // Errors are flushed at once so a crash right after them still leaves a record.
    if (level === 'ERROR' || this.pendingBytes >= FLUSH_BYTES) this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
      this.timer.unref();
    }
  }

  recent(limit: number = LOGGING_LIMITS.history) {
    const count = Math.max(0, Math.min(limit, LOGGING_LIMITS.history));
    return this.history.slice(-count);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending.length || this.writing) return;
    this.writing = true;
    const lines = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    try {
      for (const line of lines) this.append(line);
    } finally {
      this.writing = false;
    }
  }

  close() {
    this.flush();
    this.closed = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.listeners.clear();
  }

  private target(bytes: number) {
    const date = localDate(this.now());
    const limit = LOGGING_LIMITS.fileMB * 1024 * 1024;
    if (!this.file || this.file.date !== date) {
      const latest = listLogFiles(this.active)
        .filter((file) => file.date === date)
        .at(-1);
      const rolled = this.file && this.file.date !== date;
      this.file = latest
        ? { date, index: latest.index, size: latest.size, path: latest.path }
        : {
            date,
            index: 0,
            size: 0,
            path: join(this.active, `alune-${date}.log`),
          };
      if (rolled) queueMicrotask(() => this.cleanup());
    }
    if (this.file.size > 0 && this.file.size + bytes > limit) {
      const index = this.file.index + 1;
      this.file = {
        date,
        index,
        size: 0,
        path: join(this.active, `alune-${date}.${index}.log`),
      };
      queueMicrotask(() => this.cleanup());
    }
    return this.file;
  }

  private append(line: string) {
    const bytes = Buffer.byteLength(line);
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = this.target(bytes);
      try {
        appendFileSync(file.path, line, { mode: 0o600 });
        file.size += bytes;
        return;
      } catch (error) {
        this.file = undefined;
        // The directory may have been removed while running: recreate it once,
        // then fall back to the default directory. Logging never breaks the app.
        if (attempt === 0) {
          try {
            mkdirSync(this.active, { recursive: true, mode: 0o700 });
          } catch {}
        } else if (attempt === 1 && this.active !== this.defaultDirectory) {
          this.fallbackReason = `日志目录不可写（${(error as NodeJS.ErrnoException).code || 'unknown'}）；已回退到默认目录。`;
          this.active = this.defaultDirectory;
          try {
            mkdirSync(this.active, { recursive: true, mode: 0o700 });
          } catch {}
        } else return;
      }
    }
  }

  private loadHistory() {
    const files = listLogFiles(this.active);
    const lines: string[] = [];
    let budget = HISTORY_BYTES;
    for (const file of files.reverse()) {
      if (budget <= 0 || lines.length >= LOGGING_LIMITS.history) break;
      try {
        const text = readTail(file.path, budget);
        budget -= Buffer.byteLength(text);
        lines.unshift(...text.split('\n').filter(Boolean));
      } catch {}
    }
    this.history = lines
      .slice(-LOGGING_LIMITS.history)
      .map((line) => {
        try {
          const entry = JSON.parse(line) as LogEntry;
          return LOG_LEVELS.includes(entry.level) &&
            typeof entry.message === 'string'
            ? entry
            : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LogEntry => Boolean(entry));
  }

  /** Deletes files older than the retention window, then the oldest until under the size cap. */
  cleanup() {
    const files = listLogFiles(this.active);
    const cutoff = this.now();
    cutoff.setDate(cutoff.getDate() - (this.stored.retentionDays - 1));
    const oldest = localDate(cutoff);
    const current = this.file?.path;
    const remove = (path: string) => {
      try {
        rmSync(path, { force: true });
        return true;
      } catch {
        return false;
      }
    };
    const kept = files.filter(
      (file) =>
        file.path === current || file.date >= oldest || !remove(file.path),
    );
    let total = kept.reduce((sum, file) => sum + file.size, 0);
    const cap = this.stored.maxTotalMB * 1024 * 1024;
    for (const file of kept) {
      if (total <= cap) break;
      if (file.path === current) continue;
      if (remove(file.path)) total -= file.size;
    }
  }
}
