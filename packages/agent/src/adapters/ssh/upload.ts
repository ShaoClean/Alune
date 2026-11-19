import { ProtocolError } from '@alune/protocol';
import type { ClientChannel } from 'ssh2';
import type { BundleDownloadProgress } from './bundles';

export async function uploadArchive(
  open: () => Promise<ClientChannel>,
  archive: Buffer,
  signal: AbortSignal,
  progress?: (value: BundleDownloadProgress) => void,
) {
  signal.throwIfAborted();
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
      percent: Math.floor((transferred / total) * 100),
      bytesPerSecond: Math.round((transferred * 1000) / Math.max(1, now - started)),
    });
  };
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () =>
          reject(
            new ProtocolError(
              'timeout',
              '远端 Agent 上传超时，60 秒内未收到传输进展或远端完成确认。请重新测试连接。',
            ),
          ),
        60_000,
      );
      report();
      open()
        .then((ch) => {
          ch.on('error', reject);
          if (!active) return ch.close();
          ch.resume();
          ch.stderr.resume();
          let exitCode: number | undefined;
          ch.once('exit', (code: number) => {
            exitCode = code;
          });
          ch.once('close', (code?: number) => {
            if ((exitCode ?? code) === 0 && transferred === total) resolve();
            else
              reject(
                new ProtocolError(
                  'unavailable',
                  '远端 Agent 上传失败，请检查远端目录权限和可用空间。',
                ),
              );
          });
          const write = () => {
            if (!active) return;
            if (transferred === total) {
              ch.end();
              return;
            }
            const chunk = archive.subarray(transferred, transferred + 64 * 1024);
            ch.write(chunk, (error?: Error | null) => {
              if (!active) return;
              if (error) return reject(error);
              transferred += chunk.length;
              timer?.refresh();
              report();
              write();
            });
          };
          write();
        })
        .catch(reject);
    });
  } finally {
    active = false;
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
    // connectHost tears down the SSH session on any bootstrap failure.
  }
}
