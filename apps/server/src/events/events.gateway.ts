import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { LogEntry } from '@alune/shared';
import { logger, logStore } from '../logging/logger';

const LOG_ROOM = 'logs';
const LOG_BATCH_MS = 100;

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;
  private logBatch: LogEntry[] = [];
  private logTimer?: NodeJS.Timeout;
  private unsubscribeLogs?: () => void;

  afterInit() {
    // Live log entries go only to log viewers, batched to bound socket traffic.
    this.unsubscribeLogs = logStore().subscribe((entry) => {
      if (!this.server?.sockets.adapter.rooms.get(LOG_ROOM)?.size) return;
      this.logBatch.push(entry);
      if (!this.logTimer)
        this.logTimer = setTimeout(() => {
          this.logTimer = undefined;
          const batch = this.logBatch;
          this.logBatch = [];
          this.server?.to(LOG_ROOM).emit('log:entries', batch);
        }, LOG_BATCH_MS);
    });
  }

  onModuleDestroy() {
    this.unsubscribeLogs?.();
    if (this.logTimer) clearTimeout(this.logTimer);
  }

  handleConnection(client: Socket) {
    logger.debug('socket', '客户端已连接', { clientId: client.id });
  }

  handleDisconnect(client: Socket) {
    logger.debug('socket', '客户端已断开', { clientId: client.id });
  }

  @SubscribeMessage('logs:subscribe')
  subscribeLogs(@ConnectedSocket() client: Socket) {
    void client.join(LOG_ROOM);
    return { ok: true };
  }

  emitConnectionStatus(
    connectionId: string,
    status: string,
    error?: string,
    updatedAt?: number,
  ) {
    this.server?.emit('connection:status', {
      connectionId,
      status,
      error,
      updatedAt,
    });
  }

  emitRepoStatus(repositoryId: string, connectionId: string, data: any) {
    this.server.emit('repo:status', { repositoryId, connectionId, ...data });
  }

  emitCommandOutput(
    connectionId: string,
    command: string,
    data: string,
    type: 'stdout' | 'stderr',
  ) {
    this.server.emit('command:output', { connectionId, command, data, type });
  }

  emitCommandExit(connectionId: string, command: string, exitCode: number) {
    this.server.emit('command:exit', { connectionId, command, exitCode });
  }
}
