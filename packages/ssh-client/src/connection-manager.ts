import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
      const config = this._buildConnectConfig();

      client.on('ready', () => {
        this.client = client;
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
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this._connected = false;
    this._connecting = false;
  }

  async execCommand(command: string, cwd?: string, signal?: AbortSignal): Promise<CommandResult> {
    signal?.throwIfAborted();
    const client = this._ensureConnected();
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
      client.exec(fullCommand, (err, stream) => {
        if (err) {
          cleanup();
          reject(err);
          return;
        }
        channel = stream;
        stream.on('error', (error: Error) => { cleanup(); reject(error); });
        if (signal?.aborted) {
          stream.close();
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (exitCode: number | null) => {
          cleanup();
          resolve({ exitCode, stdout, stderr });
        });
      });
    });
  }

  async execCommandStream(
    command: string,
    callbacks: StreamCallbacks,
    cwd?: string,
  ): Promise<ClientChannel> {
    const client = this._ensureConnected();
    const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command;

    return new Promise((resolve, reject) => {
      client.exec(fullCommand, (err, stream) => {
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
    const client = this._ensureConnected();

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.readdir(remotePath, (err, list) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(list);
        });
      });
    });
  }

  async readFile(remotePath: string): Promise<string> {
    const client = this._ensureConnected();

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        const chunks: Buffer[] = [];
        const stream = sftp.createReadStream(remotePath);

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        stream.on('end', () => {
          resolve(Buffer.concat(chunks).toString('utf-8'));
        });

        stream.on('error', reject);
      });
    });
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    const client = this._ensureConnected();

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        const stream = sftp.createWriteStream(remotePath);
        stream.on('close', resolve);
        stream.on('error', reject);
        stream.end(content);
      });
    });
  }

  async stat(remotePath: string): Promise<any> {
    const client = this._ensureConnected();

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.stat(remotePath, (err, stats) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(stats);
        });
      });
    });
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
      existing.disconnect();
    }

    const conn = new SSHConnection(options);

    conn.on('connect', () => this.emit('connection:connected', id));
    conn.on('disconnect', () => this.emit('connection:disconnected', id));
    conn.on('error', (err) => this.emit('connection:error', id, err));

    this.connections.set(id, conn);
    return conn;
  }

  getConnection(id: string): SSHConnection | undefined {
    return this.connections.get(id);
  }

  removeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (conn) {
      conn.disconnect();
      this.connections.delete(id);
    }
  }

  disconnectAll(): void {
    for (const conn of this.connections.values()) {
      conn.disconnect();
    }
    this.connections.clear();
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
