import { Injectable } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { PullRequestsService } from './pull-requests.service';
import { PullRequestCreationService as Core } from '@alune/agent/reviews/pull-request-creation.service';
export * from '@alune/agent/reviews/pull-request-creation.service';
@Injectable()
export class PullRequestCreationService extends Core {
  constructor(repositories: RepositoryService, requests: PullRequestsService) {
    super(repositories, requests);
  }
}
