import { EventEmitter } from 'events';

type PendingChannel = { start: () => void; fail: (error: Error) => void };

// exec and SFTP both consume server session slots. Reserve one until CHANNEL_CLOSE,
// including while the open request is in flight or a cancelled channel is closing.
export class SSHChannelQueue {
  private limit = 4;
  private active = 0;
  private pending: PendingChannel[] = [];
  private opening = new Set<PendingChannel>();
  private closed?: Error;

  open<T extends EventEmitter>(
    open: (callback: (error?: Error, channel?: T) => void) => void,
    dispose: (channel: T) => void,
    callback: (error?: Error, channel?: T) => void,
    signal?: AbortSignal,
  ): void {
    let settled = false;
    let retried = false;
    const finish = (error?: Error, channel?: T) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      this.opening.delete(job);
      this.pending = this.pending.filter((pending) => pending !== job);
      callback(error, channel);
    };
    const abort = () => finish(signal?.reason ?? new Error('Command cancelled'));
    const job: PendingChannel = {
      fail: finish,
      start: () => {
        this.active++;
        this.opening.add(job);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.active--;
          this.pump();
        };
        const opened = (error?: Error, channel?: T) => {
          this.opening.delete(job);
          if (error || !channel) {
            const reason = (error as Error & { reason?: number })?.reason;
            // OpenSSH uses CONNECT_FAILED (2) for MaxSessions; other servers use
            // RESOURCE_SHORTAGE (4). Only retry rejected opens, never an executed command.
            if (!settled && !retried && !this.closed && (reason === 2 || reason === 4)) {
              retried = true;
              this.limit = 1;
              this.pending.unshift(job);
              release();
              return;
            }
            release();
            finish(error ?? new Error('SSH channel was not opened'));
            return;
          }
          channel.once('close', release);
          if (settled) {
            // A cancelled/timed-out open can still be acknowledged by the server.
            channel.on('error', () => {});
            dispose(channel);
            return;
          }
          finish(undefined, channel);
        };
        try {
          open(opened);
        } catch (error) {
          opened(error instanceof Error ? error : new Error(String(error)));
        }
      },
    };
    if (this.closed) return finish(this.closed);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.pending.push(job);
    this.pump();
  }

  close(error: Error): void {
    this.closed = error;
    for (const job of [...this.pending, ...this.opening]) job.fail(error);
  }

  private pump(): void {
    while (!this.closed && this.active < this.limit && this.pending.length) {
      this.pending.shift()!.start();
    }
  }
}
