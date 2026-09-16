import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  CommitGenerationPreferences,
  SaveAiProvider,
  TestAiProvider,
} from '@remote-git/shared';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  settings() {
    return this.ai.settings.read();
  }

  @Post('providers')
  create(@Body() body: { provider: SaveAiProvider; revision: string }) {
    return this.ai.settings.saveProvider(
      undefined,
      body?.provider,
      body?.revision,
    );
  }

  @Put('providers/:id')
  save(
    @Param('id') id: string,
    @Body() body: { provider: SaveAiProvider; revision: string },
  ) {
    return this.ai.settings.saveProvider(id, body?.provider, body?.revision);
  }

  @Put('commit-settings')
  saveCommit(
    @Body() body: { commit: CommitGenerationPreferences; revision: string },
  ) {
    return this.ai.settings.saveCommit(body?.commit, body?.revision);
  }

  private async connected<T>(
    req: Request,
    res: Response,
    operation: (signal: AbortSignal) => Promise<T>,
  ) {
    const controller = new AbortController();
    const close = () => controller.abort();
    req.once('aborted', close);
    res.once('close', close);
    try {
      return await this.ai.run(controller.signal, operation);
    } finally {
      req.off('aborted', close);
      res.off('close', close);
    }
  }

  @Post('providers/:id/test')
  test(
    @Param('id') id: string,
    @Body() body: TestAiProvider,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.connected(req, res, (signal) =>
      this.ai.test(id, body?.revision, signal, body?.modelId),
    );
  }

  @Post('providers/:id/models')
  models(
    @Param('id') id: string,
    @Body() body: { revision: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.connected(req, res, (signal) =>
      this.ai.models(id, body?.revision, signal),
    );
  }

  @Post('repositories/:id/generate')
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { revision: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.connected(req, res, (signal) =>
      this.ai.generate(id, body?.revision, signal),
    );
  }
}
