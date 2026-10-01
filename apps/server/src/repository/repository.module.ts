import { Module } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { RepositoryController } from './repository.controller';
import { ConnectionModule } from '../connection/connection.module';
import { PullRequestsController } from './pull-requests.controller';
import { PullRequestsService } from './pull-requests.service';
import { AccessTokensModule } from '../access-tokens/access-tokens.module';
import { RepositoryAnalyticsService } from './repository-analytics.service';
import { RepositoryAnalyticsController } from './repository-analytics.controller';

@Module({
  imports: [ConnectionModule, AccessTokensModule],
  controllers: [
    RepositoryController,
    PullRequestsController,
    RepositoryAnalyticsController,
  ],
  providers: [
    RepositoryService,
    PullRequestsService,
    RepositoryAnalyticsService,
  ],
  exports: [RepositoryService],
})
export class RepositoryModule {}
