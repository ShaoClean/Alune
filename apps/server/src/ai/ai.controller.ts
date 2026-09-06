import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiService } from './ai.service';

@Controller()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get(['ai/config', 'v1/gateway/config'])
  getConfig() {
    return this.aiService.getPublicConfig();
  }

  @Get(['ai/models', 'v1/models'])
  models(@Req() req: Request, @Res() res: Response) {
    return this.aiService.forward('GET', '/v1/models', 'openai', req, res);
  }

  @Post(['ai/responses', 'v1/responses'])
  responses(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.aiService.forward('POST', '/v1/responses', 'openai', req, res, body);
  }

  @Post(['ai/chat/completions', 'v1/chat/completions'])
  chatCompletions(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.aiService.forward('POST', '/v1/chat/completions', 'openai', req, res, body);
  }

  @Post(['ai/messages', 'v1/messages'])
  messages(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.aiService.forward('POST', '/v1/messages', 'anthropic', req, res, body);
  }

  @Post('ai/test')
  test(@Body() body: { model?: string; prompt?: string; protocol?: 'responses' | 'messages' }) {
    return this.aiService.test(body);
  }
}
