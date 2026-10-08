import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
} from '@nestjs/common';
import { PullRequestCenterService } from './pull-request-center.service';

@Controller('pull-request-center')
export class PullRequestCenterController {
  constructor(private readonly center: PullRequestCenterService) {}

  @Post('sources')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  sources(@Body() body: { cursor?: string }) {
    return this.center.discover(body || {});
  }

  @Post('context')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async context(@Body() body: { repositoryId: string; query: unknown }) {
    if (
      !body ||
      typeof body.repositoryId !== 'string' ||
      !/^[\da-f-]{36}$/.test(body.repositoryId)
    )
      throw new BadRequestException('请选择有效的来源仓库。');
    return this.center.context(body.repositoryId, body.query);
  }

  @Post('list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  list(
    @Body() body: { discoveryId?: string; query?: unknown; cursor?: string },
  ) {
    return this.center.list(body || {});
  }
}
