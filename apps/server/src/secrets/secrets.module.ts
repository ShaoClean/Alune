import { DynamicModule, Global, Module } from '@nestjs/common';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { localSecretStorage } from './secret-storage';
import type { SecretStorage } from './secret-storage';

export const SECRET_STORAGE = Symbol('SECRET_STORAGE');

@Global()
@Module({})
export class SecretsModule {
  static register(secrets?: SecretStorage): DynamicModule {
    return {
      module: SecretsModule,
      providers: [
        {
          provide: SECRET_STORAGE,
          useFactory: () =>
            secrets ||
            localSecretStorage(
              process.env.ALUNE_DATA_DIR || join(homedir(), '.alune'),
            ),
        },
      ],
      exports: [SECRET_STORAGE],
    };
  }
}
