import { DynamicModule, Module } from '@nestjs/common';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConnectionModule } from '../connection/connection.module';
import { RepositoryModule } from '../repository/repository.module';
import { AiSettingsStore } from './ai-settings';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import type { AiSecretStorage } from './secret-storage';
import { SECRET_STORAGE } from '../secrets/secrets.module';

@Module({})
export class AiModule {
  static register(): DynamicModule {
    return {
      module: AiModule,
      imports: [ConnectionModule, RepositoryModule],
      controllers: [AiController],
      providers: [
        AiService,
        {
          provide: AiSettingsStore,
          inject: [SECRET_STORAGE],
          useFactory: (secrets: AiSecretStorage) => {
            const dataDir =
              process.env.ALUNE_DATA_DIR || join(homedir(), '.alune');
            return new AiSettingsStore(
              join(dataDir, 'ai-settings.json'),
              secrets,
            );
          },
        },
      ],
    };
  }
}
