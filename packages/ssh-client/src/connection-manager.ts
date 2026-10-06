import { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SSHChannelQueue } from './channel-queue';
import { readSftpChunks } from './sftp-file';
import * as net from 'node:net';
import type { GitProxyStatus } from '@alune/shared';
import { connectProxySocket, createProxyBridge } from './proxy-transport';
import type { ProxySnapshot } from './proxy-transport';
import { gitFileCommand, quotePosixArgument } from './git-shell';
import { GitProxyError, proxyGitArguments, verifyLoopbackForward } from './proxy-git';

export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  readyTimeout?: number;
  proxy?: ProxySnapshot;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  // Populated instead of `stdout` when a command is read in binary mode.
  stdoutBytes?: Buffer;
}

export class CommandOutputLimitError extends Error {
  constructor() {
    super('Command output exceeded the preview limit');
  }
}

export interface StreamCallbacks {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onClose?: (exitCode: number | null) => void;
}

export class SSHConnection extends EventEmitter {
  private client: Client | null = null;
  private _connected = false;
  private _connecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private options: SSHConnectionOptions;
  private channelQueue = new SSHChannelQueue();
  private attempt?: Promise<void>;
  private controller?: AbortController;
  private manuallyDisconnected = false;
  private hasConnected = false;
  private tasks = 0;
  private bridge?: Awaited<ReturnType<typeof createProxyBridge>>;
  private forwardPort?: number;
  private forwardAttempt?: Promise<void>;
  private forwardListener?: (...args: any[]) => void;
  private forwardSockets = new Set<net.Socket>();
  forwarding: GitProxyStatus = 'disconnected';
  forwardingError?: string;

  get activeTasks() {
    return this.tasks + this.channelQueue.size;
  }
  get proxyRevision() {
    return this.options.proxy?.revision ?? null;
  }
  get proxyEnabled() {
    return this.options.proxy?.enabled ?? false;
  }
  holdTask(): () => void {
    this.tasks++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.tasks--;
      }
    };
  }

  constructor(options: SSHConnectionOptions) {
    super();
    this.options = {
      port: 22,
      readyTimeout: 20000,
      ...options,
    };
  }

  get connected(): boolean {
    return this._connected;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    if (this.attempt) return this.attempt;
    this.manuallyDisconnected = false;
    this._cancelReconnect();
    this._connecting = true;
    this.emit('connecting');
    const controller = new AbortController();
    this.controller = controller;
    const work = async () => {
      const config = this._buildConnectConfig();
      if (this.options.proxy?.enabled) {
        config.sock = await connectProxySocket(
          this.options.proxy,
          this.options.host,
          this.options.port!,
          controller.signal,
        );
      }
      if (controller.signal.aborted) {
        config.sock?.destroy();
        controller.signal.throwIfAborted();
      }
      const client = new Client();
      const channelQueue = new SSHChannelQueue();
      this.client = client;
      await new Promise<void>((resolve, reject) => {
        const cancelled = () => {
          client.destroy();
          reject(new Error('SSH 连接已取消。'));
        };
        controller.signal.addEventListener('abort', cancelled, { once: true });
        client.once('ready', () => {
          if (this.client !== client || controller.signal.aborted) return client.destroy();
          this.channelQueue = channelQueue;
          this._connected = true;
          this._connecting = false;
          this.hasConnected = true;
          this.forwarding = this.proxyEnabled ? 'preparing' : 'disabled';
          this.emit('connect');
          resolve();
          if (this.proxyEnabled) void this.prepareGitProxy().catch(() => {});
        });
        client.on('error', (error) => {
          if (this.client === client) this.emit('error', error);
          reject(error);
        });
        client.once('end', () => channelQueue.close(new Error('SSH connection ended')));
        client.once('close', () => {
          channelQueue.close(new Error('SSH connection closed'));
          controller.signal.removeEventListener('abort', cancelled);
          if (this.client !== client) return;
          this.client = null;
          this._connected = false;
          this._connecting = false;
          this.clearForwarding();
          this.forwarding = this.proxyEnabled ? 'interrupted' : 'disconnected';
          this.emit('disconnect');
          reject(new Error('SSH 连接已中断。'));
          if (!this.manuallyDisconnected && this.hasConnected) this._scheduleReconnect();
        });
        try {
          client.connect(config);
        } catch (error) {
          client.destroy();
          reject(error);
        }
      });
    };
    this.attempt = work()
      .catch((error) => {
        this._connecting = false;
        if (!this.client) this.emit('error', error);
        if (!this.manuallyDisconnected && this.hasConnected) this._scheduleReconnect();
        throw error;
      })
      .finally(() => {
        this.attempt = undefined;
      });
    return this.attempt;
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this._cancelReconnect();
    this.channelQueue.close(new Error('SSH connection closed'));
    this.clearForwarding();
    this.controller?.abort();
    this.client?.destroy();
    this.client = null;
    this._connected = false;
    this._connecting = false;
    this.forwarding = 'disconnected';
  }

  private clearForwarding() {
    if (this.forwardListener) this.client?.removeListener('tcp connection', this.forwardListener);
    this.forwardListener = undefined;
    if (this.forwardPort && this.connected) {
      try {
        this.client?.unforwardIn('127.0.0.1', this.forwardPort, () => {});
      } catch {
        /* A closing SSH session releases its listeners. */
      }
    }
    this.bridge?.close();
    this.bridge = undefined;
    this.forwardPort = undefined;
    this.forwardAttempt = undefined;
    for (const socket of this.forwardSockets) socket.destroy();
    this.forwardSockets.clear();
  }

  async prepareGitProxy(): Promise<void> {
    if (!this.proxyEnabled) {
      this.forwarding = 'disabled';
      return;
    }
    if (this.forwardPort) return;
    if (this.forwardAttempt) return this.forwardAttempt;
    const client = this._ensureConnected();
    this.forwarding = 'preparing';
    this.forwardingError = undefined;
    const attempt = (async () => {
      const bridge = await createProxyBridge(() => this.options.proxy!);
      if (this.client !== client || !this.connected) {
        bridge.close();
        throw new Error('SSH 连接已中断。');
      }
      this.bridge = bridge;
      const port = await new Promise<number>((resolve, reject) => {
        let finished = false;
        const signal = this.controller!.signal;
        const abort = () => {
          finished = true;
          clearTimeout(timer);
          reject(new Error('远端转发已取消。'));
        };
        const timer = setTimeout(() => {
          finished = true;
          signal.removeEventListener('abort', abort);
          // A server that never acknowledges an allocated port cannot be safely
          // cancelled by port number. Closing the SSH session removes its listeners.
          client.destroy();
          reject(new Error('远端转发请求超时。'));
        }, 15_000);
        signal.addEventListener('abort', abort, { once: true });
        client.forwardIn('127.0.0.1', 0, (error, allocated) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (finished) {
            if (!error) {
              try {
                client.unforwardIn('127.0.0.1', allocated, () => {});
              } catch {}
            }
            return;
          }
          finished = true;
          if (error) reject(error);
          else resolve(allocated);
        });
      });
      if (this.client !== client || !this.connected) {
        bridge.close();
        throw new Error('SSH 连接已中断。');
      }
      this.forwardPort = port;
      this.forwardListener = (info, accept, reject) => {
        if (
          this.client !== client ||
          info.destIP !== '127.0.0.1' ||
          info.destPort !== this.forwardPort
        )
          return reject();
        const channel = accept();
        const socket = net.connect(bridge.port, '127.0.0.1');
        this.forwardSockets.add(socket);
        const close = () => {
          socket.destroy();
          channel.destroy();
          this.forwardSockets.delete(socket);
        };
        socket.once('error', close);
        channel.once('error', close);
        socket.once('close', close);
        channel.once('close', close);
        channel.pipe(socket).pipe(channel);
      };
      client.on('tcp connection', this.forwardListener);
      await verifyLoopbackForward(this, port);
      if (this.client !== client || !this.connected) throw new Error();
      this.forwarding = 'ready';
    })()
      .catch((error) => {
        if (this.client === client) {
          this.clearForwarding();
          this.forwarding = this.connected
            ? error instanceof GitProxyError
              ? 'error'
              : 'denied'
            : 'interrupted';
          this.forwardingError =
            error instanceof GitProxyError
              ? error.message
              : this.connected
                ? '服务器未允许回环 TCP 转发，请检查 AllowTcpForwarding、GatewayPorts 和转发权限。'
                : 'SSH 连接中断，远端 Git 代理不可用。';
        }
        throw new GitProxyError(this.forwardingError || '远端 Git 代理不可用，请重新连接。');
      })
      .finally(() => {
        if (this.forwardAttempt === attempt) this.forwardAttempt = undefined;
      });
    this.forwardAttempt = attempt;
    return attempt;
  }

  async execGit(
    repoPath: string,
    args: string[],
    signal?: AbortSignal,
    options?: {
      onStderr?: (data: string) => void;
      onStdout?: (data: string) => void;
      stdin?: string | Buffer;
      maxOutputBytes?: number;
      strictUtf8?: boolean;
      binary?: boolean;
      environment?: Record<string, string>;
    },
  ): Promise<CommandResult> {
    if (
      !this.proxyEnabled ||
      !(
        ['fetch', 'pull', 'push', 'ls-remote'].includes(args[0]) ||
        (args[0] === 'submodule' && args[1] === 'update')
      )
    )
      return this.execCommand(
        gitFileCommand(repoPath, args, options?.environment),
        undefined,
        signal,
        options,
      );
    const release = this.holdTask();
    try {
      await this.prepareGitProxy();
      signal?.throwIfAborted();
      const adapted = await proxyGitArguments(
        this,
        repoPath,
        args,
        this.forwardPort!,
        signal,
        options?.environment,
      );
      return await this.execCommand(adapted, undefined, signal, options);
    } finally {
      release();
    }
  }

  async execCommand(
    command: string,
    cwd?: string,
    signal?: AbortSignal,
    options?: {
      onStderr?: (data: string) => void;
      onStdout?: (data: string) => void;
      stdin?: string | Buffer;
      maxOutputBytes?: number;
      strictUtf8?: boolean;
      binary?: boolean;
    },
  ): Promise<CommandResult> {
    signal?.throwIfAborted();
    this._ensureConnected();
    const fullCommand = cwd ? `cd ${quotePosixArgument(cwd)} && ${command}` : command;

    return new Promise((resolve, reject) => {
      let channel: ClientChannel | undefined;
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        cleanup();
        reject(signal?.reason ?? new Error('Command cancelled'));
        // Close only this command's channel, preserving other work on the connection.
        channel?.close();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this._exec(
        fullCommand,
        (err, stream) => {
          if (err) {
            cleanup();
            reject(err);
            return;
          }
          channel = stream;
          stream.on('error', (error: Error) => {
            cleanup();
            reject(error);
            stream.close();
          });
          if (signal?.aborted) {
            stream.close();
            return;
          }

          const stdout: Buffer[] = [];
          const stderr: Buffer[] = [];
          let bytes = 0;
          let exceeded = false;
          const collect = (chunks: Buffer[], data: Buffer) => {
            if (exceeded) return;
            bytes += data.length;
            if (bytes > (options?.maxOutputBytes ?? Infinity)) {
              exceeded = true;
              cleanup();
              reject(new CommandOutputLimitError());
              stream.close();
            } else {
              chunks.push(data);
            }
          };
          stream.on('data', (data: Buffer) => {
            collect(stdout, data);
            options?.onStdout?.(data.toString('utf8'));
          });
          stream.stderr.on('data', (data: Buffer) => {
            collect(stderr, data);
            options?.onStderr?.(data.toString('utf8'));
          });

          stream.on('close', (exitCode: number | null) => {
            cleanup();
            if (exceeded) return;
            try {
              // Decode after joining chunks so SSH packet boundaries cannot split UTF-8 characters.
              const output = Buffer.concat(stdout);
              resolve({
                exitCode,
                // Binary payloads (image blobs) must never pass through a text decoder.
                stdout: options?.binary
                  ? ''
                  : options?.strictUtf8
                    ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(output)
                    : output.toString('utf8'),
                ...(options?.binary ? { stdoutBytes: output } : {}),
                stderr: Buffer.concat(stderr).toString('utf8'),
              });
            } catch (error) {
              reject(error);
            }
          });
          if (options?.stdin !== undefined) stream.end(options.stdin);
        },
        signal,
      );
    });
  }

  // Long-lived PTYs do not occupy the short Git/SFTP queue. They still count
  // as active tasks, preventing a proxy reconnect from dropping live shells.
  openTerminal(
    cwd: string,
    cols: number,
    rows: number,
    signal: AbortSignal,
  ): Promise<ClientChannel> {
    const client = this._ensureConnected();
    signal.throwIfAborted();
    if (!cwd.startsWith('/') || cwd.includes('\0')) throw new Error('终端需要有效的绝对启动目录。');
    const command =
      'cd -P "$1" || exit 125; shell=${SHELL:-/bin/sh}; ' +
      '[ -x "$shell" ] || { printf "无法执行登录 shell\\n" >&2; exit 126; }; exec "$shell" -i';
    const release = this.holdTask();
    return new Promise((resolve, reject) => {
      let cancelled = false;
      let stream: ClientChannel | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cancelled = true;
        cleanup();
        release();
        stream?.close();
        reject(signal.reason || new Error('终端创建已取消。'));
      };
      const timer = setTimeout(() => {
        cancelled = true;
        cleanup();
        release();
        reject(new Error('SSH 终端启动超时。'));
      }, 30_000);
      signal.addEventListener('abort', abort, { once: true });
      try {
        client.exec(
          `/bin/sh -c ${quotePosixArgument(command)} alune ${quotePosixArgument(cwd)}`,
          { pty: { term: 'xterm-256color', cols, rows, width: 0, height: 0 } },
          (error, channel) => {
            cleanup();
            if (error) {
              release();
              reject(error);
              return;
            }
            stream = channel;
            channel.once('close', release);
            channel.on('error', () => {});
            if (cancelled || signal.aborted) {
              channel.resume();
              channel.stderr.resume();
              channel.close();
              release();
              return;
            }
            channel.pause();
            channel.stderr.pause();
            resolve(channel);
          },
        );
      } catch (error) {
        cleanup();
        release();
        reject(error);
      }
    });
  }

  async execCommandStream(
    command: string,
    callbacks: StreamCallbacks,
    cwd?: string,
  ): Promise<ClientChannel> {
    const fullCommand = cwd ? `cd ${quotePosixArgument(cwd)} && ${command}` : command;

    return new Promise((resolve, reject) => {
      this._exec(fullCommand, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream.on('error', () => {});
        stream.on('data', (data: Buffer) => {
          callbacks.onStdout?.(data.toString());
        });

        stream.stderr.on('data', (data: Buffer) => {
          callbacks.onStderr?.(data.toString());
        });

        stream.on('close', (exitCode: number | null) => {
          callbacks.onClose?.(exitCode);
        });

        resolve(stream);
      });
    });
  }

  async readDir(remotePath: string): Promise<any[]> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.readdir(remotePath, (err, list) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(list);
          });
        }),
    );
  }

  async withSftp<T>(operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    this._ensureConnected();
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let channel: SFTPWrapper | undefined;
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.abort(error);
        channel?.end();
        if (error) reject(error);
        else resolve(value as T);
      };
      const timer = setTimeout(() => finish(new Error('远端文件操作超时')), 15_000);
      this._sftp((error, sftp) => {
        if (settled) {
          sftp?.end();
          return;
        }
        if (error) {
          finish(error);
          return;
        }
        channel = sftp;
        sftp.on('error', (err: Error) => finish(err));
        sftp.on('close', () => finish(new Error('远端文件连接已中断')));
        Promise.resolve()
          .then(() => operation(sftp))
          .then((value) => finish(undefined, value), finish);
      }, controller.signal);
    });
  }

  async readFile(remotePath: string): Promise<string> {
    return this.withSftp(async (sftp) => {
      const chunks: Buffer[] = [];
      for await (const chunk of readSftpChunks(sftp, remotePath)) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf-8');
    });
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise<void>((resolve, reject) => {
          const stream = sftp.createWriteStream(remotePath);
          stream.on('close', resolve);
          stream.on('error', reject);
          stream.end(content);
        }),
    );
  }

  async stat(remotePath: string): Promise<any> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.stat(remotePath, (err, stats) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(stats);
          });
        }),
    );
  }

  private _exec(
    command: string,
    callback: (error: Error | undefined, channel: ClientChannel) => void,
    signal?: AbortSignal,
  ): void {
    const client = this._ensureConnected();
    this.channelQueue.open<ClientChannel>(
      (opened) => client.exec(command, opened),
      (channel) => {
        // ssh2 emits close after buffered output drains, even for cancelled opens.
        channel.on('data', () => {});
        channel.stderr.on('data', () => {});
        channel.close();
      },
      (error, channel) => callback(error, channel!),
      signal,
    );
  }

  private _sftp(
    callback: (error: Error | undefined, sftp: SFTPWrapper) => void,
    signal?: AbortSignal,
  ): void {
    const client = this._ensureConnected();
    this.channelQueue.open<SFTPWrapper>(
      (opened) => client.sftp(opened),
      (sftp) => sftp.end(),
      (error, sftp) => callback(error, sftp!),
      signal,
    );
  }

  private _buildConnectConfig(): ConnectConfig {
    const config: ConnectConfig = {
      host: this.options.host,
      port: this.options.port,
      username: this.options.username,
      readyTimeout: this.options.readyTimeout,
    };

    if (this.options.password) {
      config.password = this.options.password;
    } else if (this.options.privateKey) {
      config.privateKey = this.options.privateKey;
      if (this.options.passphrase) {
        config.passphrase = this.options.passphrase;
      }
    } else if (this.options.privateKeyPath) {
      config.privateKey = fs.readFileSync(this.options.privateKeyPath);
      if (this.options.passphrase) {
        config.passphrase = this.options.passphrase;
      }
    } else {
      const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      if (fs.existsSync(defaultKeyPath)) {
        config.privateKey = fs.readFileSync(defaultKeyPath);
      }
    }

    return config;
  }

  private _ensureConnected(): Client {
    if (!this._connected || !this.client) {
      throw new Error('SSH connection is not established');
    }
    return this.client;
  }

  private _scheduleReconnect(): void {
    this._cancelReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnecting');
      this.connect().catch(() => {});
    }, 5000);
  }

  private _cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export class SSHConnectionPool extends EventEmitter {
  private connections = new Map<string, SSHConnection>();

  createConnection(id: string, options: SSHConnectionOptions): SSHConnection {
    const existing = this.connections.get(id);
    if (existing) {
      // Remove the old entry before closing it so its late events cannot describe
      // the replacement connection.
      this.connections.delete(id);
      existing.disconnect();
    }

    const conn = new SSHConnection(options);
    const isCurrent = () => this.connections.get(id) === conn;
    conn.on('connecting', () => {
      if (isCurrent()) this.emit('connection:connecting', id);
    });
    conn.on('reconnecting', () => {
      if (isCurrent()) this.emit('connection:connecting', id);
    });
    conn.on('connect', () => {
      if (isCurrent()) this.emit('connection:connected', id);
    });
    conn.on('disconnect', () => {
      if (isCurrent()) this.emit('connection:disconnected', id);
    });
    conn.on('error', (err) => {
      if (isCurrent()) this.emit('connection:error', id, err);
    });

    this.connections.set(id, conn);
    return conn;
  }

  getConnection(id: string): SSHConnection | undefined {
    return this.connections.get(id);
  }

  removeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      this.connections.delete(id);
      conn.disconnect();
    }
  }

  disconnectAll(): void {
    const connections = [...this.connections.values()];
    this.connections.clear();
    for (const conn of connections) {
      conn.disconnect();
    }
  }
}

export function parseSSHConfig(configPath?: string): Record<string, SSHConnectionOptions> {
  const sshConfigPath = configPath || path.join(os.homedir(), '.ssh', 'config');
  const result: Record<string, SSHConnectionOptions> = {};

  if (!fs.existsSync(sshConfigPath)) {
    return result;
  }

  const content = fs.readFileSync(sshConfigPath, 'utf-8');
  const lines = content.split('\n');

  let currentHost: string | null = null;
  let currentConfig: Partial<SSHConnectionOptions> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const lowerKey = key.toLowerCase();

    if (lowerKey === 'host') {
      if (currentHost && currentConfig.host) {
        result[currentHost] = currentConfig as SSHConnectionOptions;
      }
      currentHost = value;
      currentConfig = {};
    } else if (currentHost) {
      switch (lowerKey) {
        case 'hostname':
          currentConfig.host = value;
          break;
        case 'user':
          currentConfig.username = value;
          break;
        case 'port':
          currentConfig.port = parseInt(value, 10);
          break;
        case 'identityfile':
          currentConfig.privateKeyPath = value.replace('~', os.homedir());
          break;
      }
    }
  }

  if (currentHost && currentConfig.host) {
    result[currentHost] = currentConfig as SSHConnectionOptions;
  }

  return result;
}
