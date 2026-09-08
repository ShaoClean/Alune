import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as path from 'node:path';
import { AppModule } from './app.module';

export interface ServerOptions {
  port?: number;
  host?: string;
  webRoot?: string;
  token?: string;
}

export async function startServer(options: ServerOptions = {}) {
  const app = await NestFactory.create(AppModule, { abortOnError: false });
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
            allowRequest: (req: Request, callback: (error: string | null, allowed: boolean) => void) => {
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
      app.use(express.static(webRoot, { index: false }));
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method === 'GET' && !/^\/(api|socket\.io)(\/|$)/.test(req.path) && !path.extname(req.path)) {
          res.sendFile(path.join(webRoot, 'index.html'));
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
