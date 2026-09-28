import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createProxyBridge, createProxyDispatcher } from '@alune/ssh-client';
import { ProxySettingsStore } from './proxy-settings';

@Injectable()
export class ProxyService implements OnModuleDestroy {
  private dispatcher?: ReturnType<typeof createProxyDispatcher>;
  private revision?: string;
  private bridge?: Promise<Awaited<ReturnType<typeof createProxyBridge>>>;
  private retired = new Set<ReturnType<typeof createProxyDispatcher>>();
  constructor(readonly settings: ProxySettingsStore) {}

  readonly fetch: typeof fetch = (input, init) => {
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
      this.dispatcher = snapshot.enabled
        ? createProxyDispatcher(snapshot)
        : undefined;
      this.revision = snapshot.revision;
    }
    // Explicit per-request dispatch: internal HTTP/WebSocket traffic is unaffected.
    return fetch(input, {
      ...init,
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
  };

  async updaterBridge() {
    if (!this.bridge) {
      this.bridge = createProxyBridge(() => this.settings.snapshot()).catch(
        (error) => {
          this.bridge = undefined;
          throw error;
        },
      );
    }
    const bridge = await this.bridge;
    const settings = this.settings.read();
    return {
      port: bridge.port,
      revision: settings.revision,
      enabled: settings.enabled,
    };
  }

  async onModuleDestroy() {
    if (this.bridge) (await this.bridge).close();
    await Promise.all(
      [this.dispatcher, ...this.retired].map((agent) => agent?.destroy()),
    );
  }
}
