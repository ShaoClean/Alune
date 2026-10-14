import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { LOGGING_LIMITS, type LogLevel } from '@alune/shared';
import { LogValidationError } from './log-store';
import { logger, logStore } from './logger';

const CLIENT_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR'];
const CLIENT_WINDOW_MS = 60_000;
const CLIENT_MAX_PER_WINDOW = 60;

@Controller('logs')
export class LoggingController {
  private clientWindow = { startedAt: 0, count: 0, dropped: 0 };

  @Get('settings')
  settings() {
    return logStore().settings();
  }

  @Put('settings')
  save(@Body() input: unknown) {
    try {
      return logStore().update(input);
    } catch (error) {
      if (error instanceof LogValidationError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get('recent')
  recent(@Query('limit') limit?: string) {
    const count = Number(limit);
    return logStore().recent(
      Number.isInteger(count) && count > 0 ? count : LOGGING_LIMITS.history,
    );
  }

  /** Renderer errors; rate limited so a render loop cannot flood the files. */
  @Post('client')
  @HttpCode(204)
  client(
    @Body()
    body: {
      level?: LogLevel;
      message?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    const level = CLIENT_LEVELS.includes(body?.level as LogLevel)
      ? body.level!
      : 'ERROR';
    if (typeof body?.message !== 'string' || !body.message)
      throw new BadRequestException('日志内容不能为空。');
    const now = Date.now();
    if (now - this.clientWindow.startedAt > CLIENT_WINDOW_MS) {
      if (this.clientWindow.dropped)
        logger.warn(
          'web',
          `前端日志过多，已丢弃 ${this.clientWindow.dropped} 条`,
        );
      this.clientWindow = { startedAt: now, count: 0, dropped: 0 };
    }
    if (++this.clientWindow.count > CLIENT_MAX_PER_WINDOW) {
      this.clientWindow.dropped++;
      return;
    }
    const context =
      body.context &&
      typeof body.context === 'object' &&
      !Array.isArray(body.context)
        ? body.context
        : undefined;
    const write = { INFO: logger.info, WARN: logger.warn, ERROR: logger.error }[
      level as 'INFO' | 'WARN' | 'ERROR'
    ];
    write('web', body.message.slice(0, 2000), context);
  }
}
