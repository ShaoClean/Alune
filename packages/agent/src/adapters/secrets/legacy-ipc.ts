import { randomUUID } from 'node:crypto';
import { StateFault } from '../../ports/state';

/** Only the inherited Node IPC handle of a dedicated import process is used. */
export function legacyIpcDecryptor(channel: NodeJS.Process = process) {
  if (!channel.connected || typeof channel.send !== 'function')
    throw new StateFault('unavailable', 'Legacy host IPC is unavailable');
  const pending = new Map<
    string,
    { resolve(value: string): void; reject(error: Error): void; cleanup(): void }
  >();
  let closed = false;
  const unavailable = () =>
    new StateFault(
      'unavailable',
      'The trusted legacy host could not decrypt the requested credential',
    );
  const receive = (message: unknown) => {
    const value = message as { kind?: unknown; id?: unknown; ok?: unknown; plaintext?: unknown };
    if (!value || value.kind !== 'alune.legacy.decrypted' || typeof value.id !== 'string') return;
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    request.cleanup();
    if (
      value.ok === true &&
      typeof value.plaintext === 'string' &&
      Buffer.byteLength(value.plaintext) <= 1024 * 1024
    )
      request.resolve(value.plaintext);
    else request.reject(unavailable());
  };
  const close = () => {
    if (closed) return;
    closed = true;
    channel.off('message', receive);
    channel.off('disconnect', close);
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(unavailable());
    }
    pending.clear();
  };
  channel.on('message', receive);
  channel.once('disconnect', close);
  return {
    close,
    decrypt(ciphertext: string, signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted();
      if (
        closed ||
        !channel.connected ||
        !ciphertext.startsWith('safe-storage:') ||
        ciphertext.length > 1400000 ||
        pending.size >= 16
      )
        return Promise.reject(unavailable());
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const cancel = (error: Error) => {
          const item = pending.get(id);
          if (!item) return;
          pending.delete(id);
          item.cleanup();
          reject(error);
        };
        const abort = () =>
          cancel(signal?.reason instanceof Error ? signal.reason : new Error('Aborted'));
        const timer = setTimeout(() => cancel(unavailable()), 10000);
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        };
        pending.set(id, { resolve, reject, cleanup });
        signal?.addEventListener('abort', abort, { once: true });
        try {
          channel.send!({ kind: 'alune.legacy.decrypt', id, ciphertext }, (error) => {
            if (error) cancel(unavailable());
          });
        } catch {
          cancel(unavailable());
        }
      });
    },
  };
}
