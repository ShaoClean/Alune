import { NativeRepositoryConnection } from '@alune/agent/native-repository';
import * as fs from 'node:fs';
import type { SFTPWrapper } from 'ssh2';
// Adapt the small, callback-based filesystem surface used by the shared file
// readers. Canonical Windows paths use '/' just like Windows OpenSSH.
const localFiles = {
  ...fs,
  // Match SFTP v3's no-overwrite rename contract. fs.rename would overwrite.
  rename(
    source: string,
    destination: string,
    callback: (error?: NodeJS.ErrnoException | null) => void,
  ) {
    fs.link(source, destination, (error) => {
      if (error) return callback(error);
      fs.unlink(source, (unlinkError) => {
        if (!unlinkError) return callback(null);
        // Keep both copies on an uncertain failure; never remove a path that
        // another process could have replaced while the operation was running.
        callback(
          Object.assign(
            new Error(`原文件未删除；新路径可能已创建：${destination}。${unlinkError.message}`),
            { code: unlinkError.code },
          ),
        );
      });
    });
  },
  realpath(path: string, callback: (error: NodeJS.ErrnoException | null, value?: string) => void) {
    // The native resolver expands Windows 8.3 names like Git does; the JS
    // resolver only follows links and can retain a different path spelling.
    fs.realpath.native(path, (error, value) =>
      callback(error, process.platform === 'win32' ? value?.replace(/\\/g, '/') : value),
    );
  },
  readdir(
    path: string,
    callback: (error: NodeJS.ErrnoException | null, entries?: unknown[]) => void,
  ) {
    fs.readdir(path, (error, entries) =>
      callback(
        error,
        entries?.map((filename) => ({ filename, attrs: {} })),
      ),
    );
  },
} as unknown as SFTPWrapper;

export class LocalConnection extends NativeRepositoryConnection {
  withSftp<T>(operation: (files: SFTPWrapper) => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    return operation(localFiles);
  }
}
