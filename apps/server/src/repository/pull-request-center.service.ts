import { Injectable, Optional } from '@nestjs/common';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from './repository.service';
import { PullRequestsService } from './pull-requests.service';
import { PullRequestCenterService as Core } from '@alune/agent/reviews/pull-request-center.service';
export * from '@alune/agent/reviews/pull-request-center.service';
@Injectable()
export class PullRequestCenterService extends Core {
  constructor(
    repositories: RepositoryService,
    requests: PullRequestsService,
    @Optional() connections?: ConnectionService,
  ) {
    super(repositories, requests, connections);
  }
}
