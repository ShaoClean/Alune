import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import type { CommandOptions, RepositoryTransport } from '../../modules/git/repository-transport';
import type { CommandResult } from '../../ports/process';
import { CommandOutputLimitError } from '../../ports/process';
import type { RepositoryFileSystem as SFTPWrapper } from '../../ports/repository-files';
import type { ProxySnapshot } from '../network/proxy-transport';
import { withLocalGitProxy } from './local-git-proxy';
import { join } from 'node:path';

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

// Git for Windows can leave MSYS hook children holding its output pipes open.
// MSYS exec can replace a process with a new Windows PID whose Windows parent
// has already exited. Merge MSYS's logical ancestry with the native process
// tree before stopping descendants; taskkill /T alone misses these children.
function terminateWindowsTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let fallbackStarted = false;
    const binary = require('node:path')
      .join(__dirname, '../../native/git-tree.exe')
      .replace(/app\.asar([\\/])/i, 'app.asar.unpacked$1');
    const helper = spawn(binary, [String(pid)], {
      windowsHide: true,
      stdio: 'ignore',
      shell: false,
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const fallback = () => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true;
      const taskkill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      });
      taskkill.once('error', finish);
      taskkill.once('close', finish);
    };
    const timer = setTimeout(() => {
      helper.kill();
      fallback();
    }, 8000);
    timer.unref();
    helper.once('error', fallback);
    helper.once('close', (code) => (code === 0 ? finish() : fallback()));
  });
}

// These commands inspect repository metadata rather than Git objects. Explicitly
// disable lazy fetching for this narrow set, so they need no proxy-discovery
// subprocess. Object reads still probe promisor settings before every command.
function metadataRead(args: string[]): boolean {
  if (args[0] === 'config')
    return (
      !args.some((arg) => arg === '--blob' || arg.startsWith('--blob=')) &&
      args.some((arg) => ['--get', '--get-all', '--get-regexp'].includes(arg))
    );
  if (args[0] === 'ls-files') {
    const separator = args.indexOf('--');
    return args
      .slice(1, separator < 0 ? args.length : separator)
      .every((arg) =>
        ['--stage', '-z', '--cached', '--others', '--exclude-standard', '--unmerged'].includes(arg),
      );
  }
  if (args[0] === 'symbolic-ref')
    return (
      args.at(-1) === 'HEAD' &&
      args.slice(1, -1).every((arg) => ['-q', '--quiet', '--short'].includes(arg))
    );
  return (
    args[0] === 'rev-parse' &&
    args.length > 1 &&
    args
      .slice(1)
      .every((arg) =>
        [
          '--path-format=absolute',
          '--git-dir',
          '--git-common-dir',
          '--absolute-git-dir',
          '--show-prefix',
          '--show-toplevel',
          '--is-shallow-repository',
          '--is-bare-repository',
        ].includes(arg),
      )
  );
}

export class NativeRepositoryConnection implements RepositoryTransport {
  private readonly lifetime = new AbortController();
  private readonly owned = new Set<Promise<unknown>>();
  readonly signal: AbortSignal;
  private own<T>(work: Promise<T>): Promise<T> {
    this.owned.add(work);
    return work.finally(() => this.owned.delete(work));
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    while (this.owned.size) await Promise.allSettled([...this.owned]);
  }
  constructor(
    signal?: AbortSignal,
    private readonly proxySnapshot?: () => ProxySnapshot | Promise<ProxySnapshot>,
    private readonly readOnly = false,
    private readonly proxyEnabled?: () => boolean | undefined,
  ) {
    this.signal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
  }

  // Deliberately no shell escape hatch for local repositories.
  async execCommand(): Promise<CommandResult> {
    throw new Error('本地仓库仅支持结构化 Git 命令。');
  }

  withSftp<T>(operation: (files: SFTPWrapper) => Promise<T>): Promise<T> {
    return this.own(this.withFiles(operation));
  }
  private async withFiles<T>(operation: (files: SFTPWrapper) => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    const signal = this.signal;
    const files = new Proxy(localFiles, {
      get(target, key) {
        const value = target[key as keyof typeof target];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          // Closing an acquired handle must still succeed after cancellation.
          if (key !== 'close') signal?.throwIfAborted();
          return (value as Function).apply(target, args);
        };
      },
    });
    const result = await operation(files);
    signal?.throwIfAborted();
    return result;
  }

  async hasAnyPath(paths: string[]): Promise<boolean> {
    this.signal?.throwIfAborted();
    const present = await Promise.all(
      paths.map(async (path) => {
        try {
          await fs.promises.lstat(path);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        }
      }),
    );
    return present.some(Boolean);
  }

  gitDirectory(repositoryPath: string): Promise<string | undefined> {
    return this.own(
      (async () => {
        this.signal.throwIfAborted();
        try {
          const candidate = join(repositoryPath, '.git');
          const info = await fs.promises.lstat(candidate);
          // Linked worktrees, submodules and symlinked Git directories retain
          // Git's own resolution. Never cache a path across repository reads.
          if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
          const canonical = await new Promise<string>((resolve, reject) =>
            fs.realpath.native(candidate, (error, result) =>
              error ? reject(error) : resolve(result),
            ),
          );
          this.signal.throwIfAborted();
          return process.platform === 'win32' ? canonical.replaceAll('\\', '/') : canonical;
        } catch {
          this.signal.throwIfAborted();
          return undefined;
        }
      })(),
    );
  }

  execGit(
    path: string,
    args: string[],
    signal?: AbortSignal,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    return this.own(this.runGit(path, args, signal, options));
  }
  private async runGit(
    path: string,
    args: string[],
    signal?: AbortSignal,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    signal?.throwIfAborted();
    this.signal?.throwIfAborted();
    if (this.readOnly)
      options = { ...options, environment: { ...options.environment, GIT_OPTIONAL_LOCKS: '0' } };
    if (this.readOnly && metadataRead(args))
      return this.executeGit(path, args, signal, {
        ...options,
        environment: { ...options.environment, GIT_NO_LAZY_FETCH: '1' },
      });
    // A known-disabled application proxy needs no promisor probe. Unknown or
    // unreadable policy remains conservative; never cache this hint across commands.
    if (this.proxySnapshot && this.proxyEnabled?.() !== false) {
      let network =
        ['fetch', 'pull', 'push', 'ls-remote'].includes(args[0]) ||
        (args[0] === 'submodule' && args[1] === 'update');
      if (!network) {
        // Object reads (show/diff/blame, etc.) can fetch missing objects in a
        // partial clone. Detect this before allowing an otherwise offline command.
        const partial = await this.executeGit(
          path,
          [
            'config',
            '--name-only',
            '--get-regexp',
            '^(extensions\\.partialclone|remote\\..*\\.promisor)$',
          ],
          signal,
          { environment: options.environment, maxOutputBytes: 65_536 },
        );
        if (partial.exitCode !== 0 && partial.exitCode !== 1)
          throw new Error('无法检查本地仓库的部分克隆配置，已中止 Git 操作。');
        network = partial.exitCode === 0;
      }
      // Capture once per command: saving affects the next operation, never a
      // running transfer. A corrupt/unreadable enabled setting fails closed.
      const snapshot = network ? await this.proxySnapshot() : undefined;
      if (snapshot?.enabled)
        return withLocalGitProxy(snapshot, args, options, (argv, commandOptions) =>
          this.executeGit(path, argv, signal, commandOptions),
        );
    }
    return this.executeGit(path, args, signal, options);
  }

  private executeGit(
    path: string,
    args: string[],
    signal?: AbortSignal,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    signal =
      signal && this.signal ? AbortSignal.any([signal, this.signal]) : (signal ?? this.signal);
    signal?.throwIfAborted();
    if (
      typeof path !== 'string' ||
      path.includes('\0') ||
      args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
    )
      return Promise.reject(new Error('无效的 Git 路径或参数。'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      LC_ALL: 'C',
      ...options.environment,
    };
    // The desktop may have been launched from another repository's Git hook.
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_PREFIX',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    ])
      delete env[key];
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['--literal-pathspecs', '-C', path, ...args], {
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let failure: Error | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let termination: Promise<void> | undefined;
      const max = options.maxOutputBytes ?? 32 * 1024 * 1024;
      const kill = (force = false) => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          termination ??= terminateWindowsTree(child.pid);
        } else {
          try {
            process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
          } catch {
            child.kill(force ? 'SIGKILL' : 'SIGTERM');
          }
        }
      };
      const stop = (error: Error) => {
        if (failure) return;
        failure = error;
        kill();
        if (process.platform !== 'win32') {
          killTimer = setTimeout(() => kill(true), 1500);
          killTimer.unref();
        }
      };
      const abort = () =>
        stop(signal?.reason instanceof Error ? signal.reason : new Error('Git 操作已取消。'));
      const timer = setTimeout(
        () => stop(new Error('Git 操作超时，请检查仓库状态后重试。')),
        5 * 60_000,
      );
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
      };
      const collect = (target: Buffer[], chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > max) stop(new CommandOutputLimitError());
        else target.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        collect(stdout, chunk);
        options.onStdout?.(chunk.toString('utf8'));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        collect(stderr, chunk);
        options.onStderr?.(chunk.toString('utf8'));
      });
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') stop(error);
      });
      child.stdin.end(options.stdin);
      child.on('error', (error: NodeJS.ErrnoException) => {
        cleanup();
        reject(
          error.code === 'ENOENT'
            ? new Error('未找到 Git。请安装 Git 并确保它在系统 PATH 中，然后重新启动 Alune。')
            : error,
        );
      });
      child.on('close', (exitCode) => {
        cleanup();
        if (failure) {
          void (termination ?? Promise.resolve()).then(() => reject(failure));
          return;
        }
        try {
          const output = Buffer.concat(stdout);
          resolve({
            exitCode,
            stdout: options.binary
              ? ''
              : options.strictUtf8
                ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output)
                : output.toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            ...(options.binary ? { stdoutBytes: output } : {}),
          });
        } catch (error) {
          reject(error);
        }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}

export { GitProxyError, withLocalGitProxy } from './local-git-proxy';
