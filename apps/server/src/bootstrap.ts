import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as path from 'node:path';
import { AppModule } from './app.module';
import type { AiSecretStorage } from './ai/secret-storage';

export interface ServerOptions {
  port?: number;
  host?: string;
  webRoot?: string;
  token?: string;
  aiSecretStorage?: AiSecretStorage;
}

export async function startServer(options: ServerOptions = {}) {
  // Desktop shutdown must close keep-alive and upgraded sockets before an installer can run.
  const app = await NestFactory.create(
    AppModule.register(options.aiSecretStorage),
    { abortOnError: false, forceCloseConnections: Boolean(options.token) },
  );
  try {
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
        res.sendFile(path.join(webRoot, 'index.html'));
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
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
