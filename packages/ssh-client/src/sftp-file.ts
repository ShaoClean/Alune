import { promisify } from 'util';
import type { SFTPWrapper } from 'ssh2';

// ssh2 read streams finish before their asynchronous handle close completes.
// Explicit handles let withSftp end the session only after CLOSE is acknowledged,
// also when the consumer stops early (for example at a preview size limit).
export async function* readSftpChunks(sftp: SFTPWrapper, path: string): AsyncGenerator<Buffer> {
  const handle = await promisify(sftp.open.bind(sftp))(path, 'r');
  try {
    let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const bytes = await new Promise<number>((resolve, reject) => {
        sftp.read(handle, buffer, 0, buffer.length, position, (error, bytesRead) => {
          if (error) reject(error);
          else resolve(bytesRead);
        });
      });
      if (!bytes) return;
      position += bytes;
      yield buffer.subarray(0, bytes);
    }
  } finally {
    await promisify(sftp.close.bind(sftp))(handle);
  }
}
