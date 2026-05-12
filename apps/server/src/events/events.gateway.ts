import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  emitConnectionStatus(connectionId: string, status: string, error?: string) {
    this.server.emit('connection:status', { connectionId, status, error });
  }

  emitRepoStatus(repositoryId: string, connectionId: string, data: any) {
    this.server.emit('repo:status', { repositoryId, connectionId, ...data });
  }

  emitCommandOutput(connectionId: string, command: string, data: string, type: 'stdout' | 'stderr') {
    this.server.emit('command:output', { connectionId, command, data, type });
  }

  emitCommandExit(connectionId: string, command: string, exitCode: number) {
    this.server.emit('command:exit', { connectionId, command, exitCode });
  }
}