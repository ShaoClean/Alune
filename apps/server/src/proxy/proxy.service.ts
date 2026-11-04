import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ProxyRuntime } from '@alune/agent/network';
import { ProxySettingsStore } from './proxy-settings';

@Injectable()
export class ProxyService extends ProxyRuntime implements OnModuleDestroy {
  declare readonly settings: ProxySettingsStore;
  constructor(settings: ProxySettingsStore) {
    super(settings);
  }
  onModuleDestroy() {
    return this.close();
  }
}
