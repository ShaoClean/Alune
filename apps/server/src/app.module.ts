import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ConnectionModule } from './connection/connection.module';
import { RepositoryModule } from './repository/repository.module';
import { GitModule } from './git/git.module';
import { FileModule } from './file/file.module';
import { EventsModule } from './events/events.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    ConnectionModule,
    RepositoryModule,
    GitModule,
    FileModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}