import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as path from 'node:path';
import { AppModule } from './app.module';
import type { AiSecretStorage } from './ai/secret-storage';
import { TerminalRegistry } from './terminal/terminal-registry';
import { AluneNestLogger } from './logging/nest-logger';
import { errorContext, logger, logStore } from './logging/logger';
import { registerSecret } from './logging/redact';

export interface ServerOptions {
  port?: number;
  host?: string;
  webRoot?: string;
  token?: string;
  aiSecretStorage?: AiSecretStorage;
  desktop?: boolean;
}

export async function startServer(options: ServerOptions = {}) {
  if (options.token) registerSecret(options.token);
  logStore();
  // Desktop shutdown must close keep-alive and upgraded sockets before an installer can run.
  const app = await NestFactory.create(
    AppModule.register(options.aiSecretStorage),
    {
      abortOnError: false,
      forceCloseConnections: Boolean(options.token),
      logger: new AluneNestLogger(),
    },
  );
  try {
    const terminals = app.get(TerminalRegistry);
    terminals.enabled = Boolean(options.token);
    terminals.desktop = options.desktop === true;
    if (options.token) {
      const authorization = `Bearer ${options.token}`;
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.headers.authorization !== authorization) {
          res.status(401).json({ message: 'Unauthorized' });
          return;
        }
        next();
      });
      class DesktopSocketAdapter extends IoAdapter {
        createIOServer(port: number, socketOptions?: any) {
          return super.createIOServer(port, {
            ...socketOptions,
            allowRequest: (
              req: Request,
              callback: (error: string | null, allowed: boolean) => void,
            ) => {
              callback(null, req.headers.authorization === authorization);
            },
          });
        }
      }
      app.useWebSocketAdapter(new DesktopSocketAdapter(app));
    } else {
      app.enableCors({
        origin: ['http://localhost:5173', 'http://localhost:3000'],
        credentials: true,
      });
    }

    // Multi-commit messages and escaped conflict text can exceed Express's
    // default 100 KiB JSON limit. Keep the larger budget scoped to this flow.
    app.use(
      [
        '/repositories/:id/interactive-rebase',
        '/api/repositories/:id/interactive-rebase',
      ],
      express.json({ limit: '1mb' }),
    );
    // Nest detects even a path-scoped jsonParser as an installed global parser.
    // Explicitly retain its default parser for every other endpoint.
    app.use(express.json());

    if (options.webRoot) {
      app.setGlobalPrefix('api');
      const webRoot = path.resolve(options.webRoot);
      // Vite content-hashes every built asset (js/css/svg), so those can cache forever;
      // only index.html keeps a fixed name and must always be revalidated. Otherwise a
      // persistent Electron session (or a browser) can keep serving a cached index.html
      // that still points at assets from a previous release after an upgrade.
      app.use(express.static(webRoot, { index: false }));
      const sendIndex = (res: Response) => {
        res.set('Cache-Control', 'no-cache');
        res.sendFile('index.html', { root: webRoot });
      };
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (
          req.method === 'GET' &&
          !/^\/(api|socket\.io)(\/|$)/.test(req.path) &&
          !path.extname(req.path)
        ) {
          sendIndex(res);
          return;
        }
        next();
      });
    }

    await app.listen(options.port ?? 3000, options.host ?? '127.0.0.1');
    logger.info('server', '本地服务已启动', {
      url: await app.getUrl(),
      mode: options.desktop ? 'desktop' : 'web',
    });
    return app;
  } catch (error) {
    logger.error('server', '本地服务启动失败', errorContext(error));
    await app.close();
    throw error;
  }
}
