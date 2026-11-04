import { open } from 'node:fs/promises';
import type { FileReadPort } from '../../ports/files';
import { StateFault } from '../../ports/state';

/** The handle is closed before cancellation/failure is reported to the caller. */
export const nativeFiles: FileReadPort = {
  async read(path, { signal, maxBytes }) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new StateFault('invalid-input', 'Invalid file read budget');
    const handle = await open(path, 'r');
    try {
      signal?.throwIfAborted();
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes)
        throw new StateFault('invalid-input', 'File exceeds the allowed read budget');
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (true) {
        signal?.throwIfAborted();
        const buffer = Buffer.allocUnsafe(Math.min(65536, maxBytes - bytes + 1));
        const result = await handle.read(buffer, 0, buffer.length, null);
        signal?.throwIfAborted();
        if (!result.bytesRead) break;
        bytes += result.bytesRead;
        if (bytes > maxBytes)
          throw new StateFault('invalid-input', 'File grew beyond the allowed read budget');
        chunks.push(buffer.subarray(0, result.bytesRead));
      }
      return Buffer.concat(chunks, bytes);
    } finally {
      await handle.close();
    }
  },
};
