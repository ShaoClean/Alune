import {
  SSHConnectionPool,
  type SSHConnection,
  type SSHConnectionOptions,
} from '../../adapters/ssh/connection-manager';
type ConnectionActivityStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'unknown';
interface ConnectionStatusInfo {
  status: ConnectionActivityStatus;
  error?: string;
  updatedAt?: number;
}
// The legacy HTTP adapter supplies its old configuration source and notifications;
// connection ownership, in-flight joins and status ordering live with Agent hosts.
export class HostConnections {
  readonly pool = new SSHConnectionPool();
  readonly connecting = new Map<string, Promise<SSHConnection>>();
  private statuses = new Map<string, ConnectionStatusInfo>();
  private readonly startedAt = Date.now();
  private lastStatusAt = this.startedAt;
  constructor(
    private options: (id: string) => Promise<SSHConnectionOptions>,
    private proxy: () => SSHConnectionOptions['proxy'],
    private changed: (id: string, info: ConnectionStatusInfo) => void,
  ) {
    // SSH activity is the single source of truth for the status shown in the UI.
    this.pool.on('connection:connecting', (id: string) => this.set(id, 'connecting'));
    this.pool.on('connection:connected', (id: string) => this.set(id, 'connected'));
    this.pool.on('connection:disconnected', (id: string) => {
      // ssh2 closes the socket right after reporting an error; keep the specific
      // failure instead of replacing it with a bare "disconnected".
      if (this.statuses.get(id)?.status !== 'error') this.set(id, 'disconnected');
    });
    this.pool.on('connection:error', (id: string, error: Error) =>
      this.set(id, 'error', error?.message),
    );
  }

  private set(id: string, status: ConnectionActivityStatus, error?: string) {
    const current = this.statuses.get(id);
    // ensureConnected reports the attempt before ssh2 does; do not emit it twice.
    if (current && current.status === status && current.error === error) return current;
    const updatedAt = Math.max(Date.now(), this.lastStatusAt + 1);
    this.lastStatusAt = updatedAt;
    const info: ConnectionStatusInfo = { status, error, updatedAt };
    this.statuses.set(id, info);
    this.changed(id, info);
    return info;
  }

  getStatus(id: string): ConnectionStatusInfo {
    return this.statuses.get(id) ?? { status: 'unknown', updatedAt: this.startedAt };
  }

  remove(id: string) {
    this.pool.removeConnection(id);
    this.statuses.delete(id);
  }
  close() {
    this.pool.disconnectAll();
  }
  async ensureConnected(id: string): Promise<SSHConnection> {
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const existing = this.pool.getConnection(id);
    if (existing?.connected) return existing;
    if (existing) {
      await existing.connect();
      return existing;
    }
    // Report the attempt immediately: reading the config or the key file happens
    // before ssh2 can emit anything of its own.
    this.set(id, 'connecting');
    const request = (async () => {
      const config = await this.options(id);
      const conn = this.pool.createConnection(id, { ...config, proxy: this.proxy() });
      await conn.connect();
      return conn;
    })()
      .catch((error: any) => {
        // A failure before ssh2 reports one of its own errors (unknown connection,
        // unreadable key file) must not leave the status stuck on "connecting".
        if (this.statuses.get(id)?.status === 'connecting') this.set(id, 'error', error?.message);
        throw error;
      })
      .finally(() => this.connecting.delete(id));
    // Concurrent status reads for one host must share its connection attempt.
    this.connecting.set(id, request);
    return request;
  }
}
