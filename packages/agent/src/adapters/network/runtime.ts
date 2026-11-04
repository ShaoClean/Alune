import { createProxyBridge, createProxyDispatcher, type ProxySnapshot } from './proxy-transport';
import type { NetworkProxyConfig } from '@alune/protocol';
import { StateFault } from '../../ports/state';

export interface NetworkProxySettings {
  snapshot(): ProxySnapshot;
  read(): NetworkProxyConfig;
}
/** Owns only explicit external requests and the local updater bridge. */
export class ProxyRuntime {
  private dispatcher?: ReturnType<typeof createProxyDispatcher>;
  private revision?: string;
  private bridge?: Promise<Awaited<ReturnType<typeof createProxyBridge>>>;
  private retired = new Set<ReturnType<typeof createProxyDispatcher>>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(readonly settings: NetworkProxySettings) {}
  readonly fetch: typeof fetch = (input, init) => {
    if (this.closed) throw new StateFault('unavailable', 'Network runtime is closed');
    const snapshot = this.settings.snapshot();
    if (this.revision !== snapshot.revision) {
      if (this.dispatcher) {
        const previous = this.dispatcher;
        this.retired.add(previous);
        void previous
          .close()
          .catch(() => {})
          .finally(() => this.retired.delete(previous));
      }
      this.dispatcher = snapshot.enabled ? createProxyDispatcher(snapshot) : undefined;
      this.revision = snapshot.revision;
    }
    // Per-request dispatch preserves internal HTTP/WebSocket and PR/MR routes.
    return fetch(input, { ...init, ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}) });
  };
  async updaterBridge() {
    if (this.closed) throw new StateFault('unavailable', 'Network runtime is closed');
    if (!this.bridge)
      this.bridge = createProxyBridge(() => this.settings.snapshot()).catch((error) => {
        this.bridge = undefined;
        throw error;
      });
    const bridge = await this.bridge;
    if (this.closed) {
      bridge.close();
      throw new StateFault('unavailable', 'Network runtime is closed');
    }
    const settings = this.settings.read();
    return { port: bridge.port, revision: settings.revision, enabled: settings.enabled };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      if (this.bridge) {
        const bridge = await this.bridge.catch(() => undefined);
        bridge?.close();
      }
      await Promise.all([this.dispatcher, ...this.retired].map((agent) => agent?.destroy()));
    })();
    return this.closing;
  }
}
