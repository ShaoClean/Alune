import { ProtocolError } from '@alune/protocol';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import type { BundleDownloadProgress } from './bundles';

export const DEFAULT_UPLOAD_IDLE_TIMEOUT_MS = 45_000;
export const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;
const SFTP_CHUNK_SIZE = 32 * 1024;
const SFTP_CONCURRENCY = 8;
const EXEC_BINARY_CHUNK_SIZE = 64 * 1024;
// Divisible by 3 so each Base64 line encodes cleanly without mid-stream padding.
const EXEC_BASE64_CHUNK_SIZE = 48 * 1024;
const STDERR_LIMIT = 4096;

export class SftpUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SftpUnavailableError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface SftpUploadOptions {
  idleTimeoutMs?: number;
  chunkSize?: number;
  concurrency?: number;
  resume?: boolean;
}

export interface SftpUploadResult {
  resumed: boolean;
  resumedFrom: number;
}

export interface ExecUploadOptions {
  encoding?: 'binary' | 'base64-lines';
  idleTimeoutMs?: number;
  confirmTimeoutMs?: number;
}

function summarizeStderr(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > 240 ? cleaned.slice(0, 240) + '…' : cleaned;
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && error === signal.reason;
}

export async function uploadArchiveViaSftp(
  openSftp: () => Promise<SFTPWrapper>,
  remoteDir: string,
  remotePath: string,
  archive: Buffer,
  signal: AbortSignal,
  progress?: (value: BundleDownloadProgress) => void,
  options: SftpUploadOptions = {},
): Promise<SftpUploadResult> {
  signal.throwIfAborted();
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_UPLOAD_IDLE_TIMEOUT_MS;
  const chunkSize = options.chunkSize ?? SFTP_CHUNK_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? SFTP_CONCURRENCY);
  const allowResume = options.resume ?? true;
  const total = archive.length;

  let sftp: SFTPWrapper | undefined;
  let handle: Buffer | undefined;
  let settled = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;

  try {
    sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new ProtocolError(
            'timeout',
            '远端 SFTP 通道初始化超时，请检查网络连接或 SSH 服务器配置。',
          ),
        );
      }, idleTimeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      openSftp().then(
        (wrapper) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            wrapper.end();
            reject(signal.reason);
            return;
          }
          resolve(wrapper);
        },
        (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          if (isAbortError(error, signal) || signal.aborted) {
            reject(signal.reason ?? error);
            return;
          }
          reject(
            new SftpUnavailableError(
              error instanceof Error ? error.message : String(error),
              error,
            ),
          );
        },
      );
    });

    const channel = sftp;
    let disconnectReject: ((error: Error) => void) | undefined;
    const onError = (error: Error) => disconnectReject?.(error);
    const onClose = () =>
      disconnectReject?.(new ProtocolError('disconnected', '远端 SFTP 上传连接已中断。'));
    channel.on('error', onError);
    channel.once('close', onClose);

    const runStep = <T>(
      fn: (done: (error?: Error | null, value?: T) => void) => void,
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        let doneFlag = false;
        const finish = (error?: Error | null, value?: T) => {
          if (doneFlag) return;
          doneFlag = true;
          clearTimeout(stepTimer);
          signal.removeEventListener('abort', onStepAbort);
          disconnectReject = undefined;
          if (error) reject(error);
          else resolve(value as T);
        };
        const stepTimer = setTimeout(
          () =>
            finish(
              new ProtocolError(
                'timeout',
                '远端 Agent 上传超时，长时间未收到远端 SFTP 响应。请检查网络后重试。',
              ),
            ),
          idleTimeoutMs,
        );
        const onStepAbort = () => finish(signal.reason);
        signal.addEventListener('abort', onStepAbort, { once: true });
        disconnectReject = (err) => finish(err);
        try {
          fn(finish);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });

    // Ensure remote staging directory exists.
    try {
      await runStep<void>((done) => channel.mkdir(remoteDir, { mode: 0o700 }, done));
    } catch (mkdirError) {
      if (isAbortError(mkdirError, signal) || mkdirError instanceof ProtocolError) {
        throw mkdirError;
      }
      // Directory may already exist; verify with stat.
      try {
        await runStep<unknown>((done) => channel.stat(remoteDir, done));
      } catch {
        throw new ProtocolError(
          'unavailable',
          `远端 Agent 目录创建失败：${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`,
        );
      }
    }

    // Check for an existing partial upload to support resume.
    let resumeOffset = 0;
    if (allowResume) {
      try {
        const stats = await runStep<{ size: number }>((done) => channel.stat(remotePath, done));
        if (Number.isSafeInteger(stats?.size) && stats.size > 0 && stats.size <= total) {
          resumeOffset = stats.size;
        }
      } catch (statError) {
        if (isAbortError(statError, signal) || statError instanceof ProtocolError) {
          throw statError;
        }
      }
    }

    const started = Date.now();
    let lastReport = 0;
    let acked = resumeOffset;
    const report = (force = false) => {
      const now = Date.now();
      if (!force && acked > resumeOffset && acked < total && now - lastReport < 150) return;
      lastReport = now;
      const sentNow = Math.max(0, acked - resumeOffset);
      progress?.({
        transferred: acked,
        total,
        percent: total > 0 ? Math.floor((acked / total) * 100) : 100,
        bytesPerSecond: Math.round((sentNow * 1000) / Math.max(1, now - started)),
      });
    };

    if (resumeOffset === total) {
      report(true);
      channel.off('error', onError);
      channel.off('close', onClose);
      return { resumed: true, resumedFrom: resumeOffset };
    }

    handle = await runStep<Buffer>((done) =>
      channel.open(remotePath, resumeOffset > 0 ? 'r+' : 'w', { mode: 0o600 }, done),
    );
    const fileHandle = handle;

    await new Promise<void>((resolve, reject) => {
      let nextOffset = resumeOffset;
      let inFlight = 0;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        if (abortListener) signal.removeEventListener('abort', abortListener);
        disconnectReject = undefined;
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        if (abortListener) signal.removeEventListener('abort', abortListener);
        disconnectReject = undefined;
        resolve();
      };
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          fail(
            new ProtocolError(
              'timeout',
              `远端 Agent 上传超时，${Math.round(idleTimeoutMs / 1000)} 秒内未收到远端写入确认。请检查网络后重试。`,
            ),
          );
        }, idleTimeoutMs);
      };
      abortListener = () => fail(signal.reason);
      signal.addEventListener('abort', abortListener, { once: true });
      disconnectReject = (err) => fail(err);

      resetIdle();
      report(true);

      const pump = () => {
        if (settled) return;
        if (nextOffset >= total && inFlight === 0) {
          report(true);
          succeed();
          return;
        }
        while (!settled && inFlight < concurrency && nextOffset < total) {
          const offset = nextOffset;
          const length = Math.min(chunkSize, total - offset);
          nextOffset += length;
          inFlight++;
          channel.write(fileHandle, archive, offset, length, offset, (err) => {
            if (settled) return;
            if (err) {
              fail(
                new ProtocolError(
                  'unavailable',
                  `远端 Agent 上传写入失败：${err.message || String(err)}`,
                ),
              );
              return;
            }
            inFlight--;
            acked += length;
            resetIdle();
            report(acked >= total);
            pump();
          });
        }
      };

      pump();
    });

    await runStep<void>((done) => channel.close(fileHandle, done));
    handle = undefined;
    channel.off('error', onError);
    channel.off('close', onClose);
    return { resumed: resumeOffset > 0, resumedFrom: resumeOffset };
  } finally {
    settled = true;
    clearTimeout(idleTimer);
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (sftp && handle) {
      try {
        sftp.close(handle, () => {});
      } catch {
        // Ignore cleanup close failures.
      }
    }
    try {
      sftp?.end();
    } catch {
      // Ignore cleanup end failures.
    }
  }
}

export async function uploadArchive(
  open: () => Promise<ClientChannel>,
  archive: Buffer,
  signal: AbortSignal,
  progress?: (value: BundleDownloadProgress) => void,
  options: ExecUploadOptions = {},
) {
  signal.throwIfAborted();
  const encoding = options.encoding ?? 'binary';
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_UPLOAD_IDLE_TIMEOUT_MS;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  let active = true;
  let transferred = 0;
  let lastReport = 0;
  const started = Date.now();
  const total = archive.length;
  const report = () => {
    const now = Date.now();
    if (transferred && transferred < total && now - lastReport < 150) return;
    lastReport = now;
    progress?.({
      transferred,
      total,
      percent: total > 0 ? Math.floor((transferred / total) * 100) : 100,
      bytesPerSecond: Math.round((transferred * 1000) / Math.max(1, now - started)),
    });
  };
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        reject(error);
      };
      const armTimer = (ms: number, message: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => fail(new ProtocolError('timeout', message)), ms);
      };
      abort = () => fail(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      armTimer(
        idleTimeoutMs,
        `远端 Agent 上传超时，${Math.round(idleTimeoutMs / 1000)} 秒内未收到传输进展。请检查网络后重试。`,
      );
      report();
      open()
        .then((ch) => {
          ch.on('error', fail);
          if (!active) return ch.close();
          ch.resume();
          let stderr = '';
          if (typeof ch.stderr?.on === 'function') {
            ch.stderr.on('data', (chunk: Buffer) => {
              if (stderr.length < STDERR_LIMIT) {
                stderr += chunk.toString('utf8', 0, STDERR_LIMIT - stderr.length);
              }
            });
          } else {
            ch.stderr?.resume();
          }
          let exitCode: number | undefined;
          ch.once('exit', (code: number) => {
            exitCode = code;
          });
          ch.once('close', (code?: number) => {
            if (!active) return;
            active = false;
            clearTimeout(timer);
            if ((exitCode ?? code) === 0 && transferred === total) {
              resolve();
            } else {
              const detail = summarizeStderr(stderr);
              reject(
                new ProtocolError(
                  'unavailable',
                  detail
                    ? `远端 Agent 上传失败：${detail}`
                    : '远端 Agent 上传失败，请检查远端目录权限和可用空间。',
                ),
              );
            }
          });
          const chunkSize =
            encoding === 'base64-lines' ? EXEC_BASE64_CHUNK_SIZE : EXEC_BINARY_CHUNK_SIZE;
          const write = () => {
            if (!active) return;
            if (transferred === total) {
              armTimer(
                confirmTimeoutMs,
                `远端 Agent 校验确认超时（${Math.round(confirmTimeoutMs / 1000)} 秒），请检查远端磁盘状态后重试。`,
              );
              if (encoding === 'base64-lines') {
                ch.write('END\n', (error?: Error | null) => {
                  if (!active) return;
                  if (error) return fail(error);
                  ch.end();
                });
              } else {
                ch.end();
              }
              return;
            }
            const chunk = archive.subarray(transferred, transferred + chunkSize);
            const payload: Buffer | string =
              encoding === 'base64-lines' ? chunk.toString('base64') + '\n' : chunk;
            ch.write(payload, (error?: Error | null) => {
              if (!active) return;
              if (error) return fail(error);
              transferred += chunk.length;
              armTimer(
                idleTimeoutMs,
                `远端 Agent 上传超时，${Math.round(idleTimeoutMs / 1000)} 秒内未收到传输进展。请检查网络后重试。`,
              );
              report();
              write();
            });
          };
          write();
        })
        .catch(fail);
    });
  } finally {
    active = false;
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
    // connectHost tears down the SSH session on any bootstrap failure.
  }
}
