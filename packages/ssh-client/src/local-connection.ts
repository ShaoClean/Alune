import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { SFTPWrapper } from 'ssh2';
import { CommandOutputLimitError } from './connection-manager';
import type { CommandResult } from './connection-manager';
import type { CommandOptions, RepositoryTransport } from './repository-transport';

// Adapt the small, callback-based filesystem surface used by the shared file
// readers. Canonical Windows paths use '/' just like Windows OpenSSH.
const localFiles = {
  ...fs,
  realpath(path: string, callback: (error: NodeJS.ErrnoException | null, value?: string) => void) {
    fs.realpath(path, (error, value) =>
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
// Capture descendants before killing their parents, then rescan remembered
// parents to catch a child created during termination. taskkill /T alone can
// miss such a child once the intermediate parent has exited.
function terminateWindowsTree(pid: number): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
$known = @{ ${pid} = $true }
for ($pass = 0; $pass -lt 3; $pass++) {
  $snapshot = @(Get-CimInstance Win32_Process)
  $targets = @(${pid})
  do {
    $added = $false
    foreach ($entry in $snapshot) {
      $childId = [int]$entry.ProcessId
      if (!$known.ContainsKey($childId) -and $known.ContainsKey([int]$entry.ParentProcessId)) {
        $known[$childId] = $true
        $targets += $childId
        $added = $true
      }
    }
  } while ($added)
  [array]::Reverse($targets)
  foreach ($childId in $targets) {
    Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue
  }
  foreach ($childId in @($known.Keys)) {
    Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue
  }
  if ($pass -lt 2) { Start-Sleep -Milliseconds 100 }
}`;
  return new Promise((resolve) => {
    let settled = false;
    let fallbackStarted = false;
    const helper = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: 'ignore', shell: false },
    );
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

export class LocalConnection implements RepositoryTransport {
  constructor(readonly signal?: AbortSignal) {}

  // Deliberately no shell escape hatch for local repositories.
  async execCommand(): Promise<CommandResult> {
    throw new Error('本地仓库仅支持结构化 Git 命令。');
  }

  withSftp<T>(operation: (files: SFTPWrapper) => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted();
    return operation(localFiles);
  }

  execGit(
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
        stdio: ['ignore', 'pipe', 'pipe'],
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
      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
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
