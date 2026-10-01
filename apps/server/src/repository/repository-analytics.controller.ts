import { Body, Controller, Post } from '@nestjs/common';
import { RepositoryAnalyticsService } from './repository-analytics.service';

@Controller('repositories/analytics')
export class RepositoryAnalyticsController {
  constructor(private readonly analytics: RepositoryAnalyticsService) {}

  @Post('summary')
  summary(
    @Body() body: { ids?: unknown; collect?: unknown; refresh?: unknown },
  ) {
    return this.analytics.batch(body);
  }
}
