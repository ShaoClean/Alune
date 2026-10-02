import { DynamicModule, Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import type { AiSecretStorage } from './ai/secret-storage';
import { DatabaseModule } from './database/database.module';
import { ConnectionModule } from './connection/connection.module';
import { RepositoryModule } from './repository/repository.module';
import { GitModule } from './git/git.module';
import { FileModule } from './file/file.module';
import { EventsModule } from './events/events.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SecretsModule } from './secrets/secrets.module';
import { ProxyModule } from './proxy/proxy.module';
import { ProxyController } from './proxy/proxy.controller';
import { TerminalModule } from './terminal/terminal.module';

@Module({
  imports: [
    DatabaseModule,
    ConnectionModule,
    RepositoryModule,
    GitModule,
    FileModule,
    EventsModule,
    TerminalModule,
  ],
  controllers: [AppController, ProxyController],
  providers: [AppService],
})
export class AppModule {
  static register(secrets?: AiSecretStorage): DynamicModule {
    return {
      module: AppModule,
      imports: [
        SecretsModule.register(secrets),
        ProxyModule.register(),
        AiModule.register(),
      ],
    };
  }
}
