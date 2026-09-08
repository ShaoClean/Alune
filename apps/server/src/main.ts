import { startServer } from './bootstrap';

async function bootstrap() {
  const app = await startServer();
  app.enableShutdownHooks();
  console.log(`Server running on ${await app.getUrl()}`);
}
void bootstrap();
