import { Module } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { RepositoryController } from './repository.controller';
import { ConnectionModule } from '../connection/connection.module';
import { PullRequestsController } from './pull-requests.controller';
import { PullRequestsService } from './pull-requests.service';
import { AccessTokensModule } from '../access-tokens/access-tokens.module';

@Module({
  imports: [ConnectionModule, AccessTokensModule],
  controllers: [RepositoryController, PullRequestsController],
  providers: [RepositoryService, PullRequestsService],
  exports: [RepositoryService],
})
export class RepositoryModule {}
