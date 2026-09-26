import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { PullRequestsService } from './pull-requests.service';

@Controller('repositories/:id/pull-requests')
export class PullRequestsController {
  constructor(private readonly requests: PullRequestsService) {}

  @Get('remotes')
  @Header('Cache-Control', 'no-store')
  remotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.remotes(id);
  }

  // Read-only POST keeps temporary credentials out of URLs, history and caches.
  @Post('list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  list(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.list(id, body);
  }
}
