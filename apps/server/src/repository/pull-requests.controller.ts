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
import { PullRequestCreationService } from './pull-request-creation.service';
import { PullRequestsService } from './pull-requests.service';

@Controller('repositories/:id/pull-requests')
export class PullRequestsController {
  constructor(
    private readonly requests: PullRequestsService,
    private readonly creation: PullRequestCreationService,
  ) {}

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

  @Post('detail')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  detail(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.detail(id, body);
  }

  @Post('files')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  files(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.files(id, body);
  }

  @Post('discussions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  discussions(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.discussions(id, body);
  }

  @Post('actions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  actions(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.actions(id, body);
  }

  @Post('mutate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  mutate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.mutate(id, body);
  }

  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.creation.preview(id, body);
  }

  @Post('create')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.creation.create(id, body);
  }

  @Post('token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  applyToken(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.requests.applyToken(id, body);
  }
}
