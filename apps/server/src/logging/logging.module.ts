import { Module, OnApplicationShutdown } from '@nestjs/common';
import { LoggingController } from './logging.controller';
import { logger, logStore } from './logger';

@Module({ controllers: [LoggingController] })
export class LoggingModule implements OnApplicationShutdown {
  onApplicationShutdown(signal?: string) {
    logger.info('server', '本地服务已关闭', signal ? { signal } : undefined);
    logStore().flush();
  }
}
