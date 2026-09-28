import { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SSHChannelQueue } from './channel-queue';
import { readSftpChunks } from './sftp-file';

export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  readyTimeout?: number;
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
    if (this._connected || this._connecting) return;

    this._connecting = true;
    this.emit('connecting');

    return new Promise((resolve, reject) => {
      const client = new Client();
      const channelQueue = new SSHChannelQueue();
      const config = this._buildConnectConfig();

      client.on('ready', () => {
        this.client = client;
        this.channelQueue = channelQueue;
        this._connected = true;
        this._connecting = false;
        this.emit('connect');
        resolve();
      });

      client.on('error', (err) => {
        this._connecting = false;
        this.emit('error', err);
        if (!this._connected) {
          reject(err);
        }
      });

      client.on('close', () => {
        channelQueue.close(new Error('SSH connection closed'));
        const wasConnected = this._connected;
        this._connected = false;
        this._connecting = false;
        this.client = null;
        this.emit('disconnect');
        if (wasConnected) {
          this._scheduleReconnect();
        }
      });

      client.on('end', () => {
        channelQueue.close(new Error('SSH connection ended'));
        this._connected = false;
        this._connecting = false;
        this.client = null;
        this.emit('disconnect');
      });

      client.connect(config);
    });
  }

  disconnect(): void {
    this._cancelReconnect();
    this.channelQueue.close(new Error('SSH connection closed'));
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this._connected = false;
    this._connecting = false;
  }

  async execCommand(
    command: string,
    cwd?: string,
    signal?: AbortSignal,
    options?: { maxOutputBytes?: number; strictUtf8?: boolean; binary?: boolean },
  ): Promise<CommandResult> {
    signal?.throwIfAborted();
    this._ensureConnected();
    const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command;

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
          stream.on('data', (data: Buffer) => collect(stdout, data));
          stream.stderr.on('data', (data: Buffer) => collect(stderr, data));

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
        },
        signal,
      );
    });
  }

  async execCommandStream(
    command: string,
    callbacks: StreamCallbacks,
    cwd?: string,
  ): Promise<ClientChannel> {
    const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command;

    return new Promise((resolve, reject) => {
      this._exec(fullCommand, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

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
