import { startServer } from './bootstrap';
import { errorContext, logger } from './logging/logger';

// Monitor only: keeps Node's default crash behavior while recording the cause.
process.on('uncaughtExceptionMonitor', (error, origin) =>
  logger.error('process', `未捕获异常（${origin}）`, errorContext(error)),
);

async function bootstrap() {
  const app = await startServer();
  app.enableShutdownHooks();
  console.log(`Server running on ${await app.getUrl()}`);
}
void bootstrap();
