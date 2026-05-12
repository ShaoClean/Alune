import { Module } from '@nestjs/common';
import { GitService } from './git.service';
import { GitController } from './git.controller';
import { RepositoryModule } from '../repository/repository.module';
import { ConnectionModule } from '../connection/connection.module';

@Module({
  imports: [ConnectionModule, RepositoryModule],
  controllers: [GitController],
  providers: [GitService],
})
export class GitModule {}
