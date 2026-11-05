import type { CommandOptions, CommandResult, GitProcessPort } from './process';

/** Callback filesystem contract shared by native and legacy SFTP adapters.
 * No SSH client, connection or channel is part of the business layer.
 * Handles are opaque to readers; the native adapter uses numeric descriptors.
 */
export interface FileStats {
  mode: number;
  size: number;
  mtime: number | Date;
  uid: number;
  gid: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
type Callback<T> = (error: Error | undefined, value: T) => void;
export interface RepositoryFileSystem {
  realpath(path: string, callback: Callback<string>): void;
  lstat(path: string, callback: Callback<FileStats>): void;
  stat(path: string, callback: Callback<FileStats>): void;
  readlink(path: string, callback: Callback<string>): void;
  readdir(
    path: string,
    callback: Callback<Array<{ filename: string; attrs: { mode?: number; size?: number } }>>,
  ): void;
  open(path: string, mode: 'wx' | 'w', permissions: number, callback: Callback<Buffer>): void;
  open(path: string, mode: 'r' | 'w', callback: Callback<Buffer>): void;
  write(
    handle: Buffer,
    bytes: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error?: Error | null) => void,
  ): void;
  mkdir(path: string, attrs: { mode: number }, callback: (error?: Error | null) => void): void;
  mkdir(path: string, callback: (error?: Error | null) => void): void;
  unlink(path: string, callback: (error?: Error | null) => void): void;
  rmdir(path: string, callback: (error?: Error | null) => void): void;
  rename(source: string, destination: string, callback: (error?: Error | null) => void): void;
  createWriteStream(path: string, options: { flags: 'a' }): import('node:stream').Writable;

  read(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (error: Error | undefined, bytes: number, buffer: Buffer, position: number) => void,
  ): void;
  close(handle: Buffer, callback: (error?: Error | null) => void): void;
}
export interface RepositoryTransport {
  close?(): Promise<void>;
  signal?: AbortSignal;
  withSftp<T>(operation: (files: RepositoryFileSystem) => Promise<T>): Promise<T>;
  hasAnyPath?: (paths: string[]) => Promise<boolean>;
  execGit?: GitProcessPort['execGit'];
  // Legacy SSH shell adapter only. The native adapter rejects this operation.
  execCommand(
    command: string,
    cwd?: string,
    signal?: AbortSignal,
    options?: CommandOptions,
  ): Promise<CommandResult>;
}
