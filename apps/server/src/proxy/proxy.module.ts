import { DynamicModule, Global, Module } from '@nestjs/common';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SECRET_STORAGE } from '../secrets/secrets.module';
import type { SecretStorage } from '../secrets/secret-storage';
import { ProxySettingsStore } from './proxy-settings';
import { ProxyService } from './proxy.service';

@Global()
@Module({})
export class ProxyModule {
  static register(): DynamicModule {
    return {
      module: ProxyModule,
      providers: [
        ProxyService,
        {
          provide: ProxySettingsStore,
          inject: [SECRET_STORAGE],
          useFactory: (secrets: SecretStorage) => {
            const directory =
              process.env.ALUNE_DATA_DIR || join(homedir(), '.alune');
            return new ProxySettingsStore(
              join(directory, 'network-proxy.json'),
              secrets,
            );
          },
        },
      ],
      exports: [ProxyService],
    };
  }
}
