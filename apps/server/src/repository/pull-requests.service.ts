import { Injectable } from '@nestjs/common';
import { RepositoryService } from './repository.service';
import { AccessTokensService } from '../access-tokens/access-tokens.service';
import { traceHttp } from '../logging/logger';
import { PullRequestsService as Core } from '@alune/agent/reviews/pull-requests.service';
export * from '@alune/agent/reviews/pull-requests.service';
@Injectable()
export class PullRequestsService extends Core {
  constructor(repositories: RepositoryService, tokens: AccessTokensService) {
    super(repositories, tokens, traceHttp);
  }
}
