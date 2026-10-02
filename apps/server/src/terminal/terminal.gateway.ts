import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import type { TerminalReply } from '@alune/shared';
import { TerminalService } from './terminal.service';
import { TerminalRegistry } from './terminal-registry';

@WebSocketGateway({ namespace: '/terminal', maxHttpBufferSize: 32 * 1024 })
export class TerminalGateway implements OnGatewayInit, OnGatewayDisconnect {
  constructor(
    private terminals: TerminalService,
    private registry: TerminalRegistry,
  ) {}
  afterInit(server: Namespace) {
    server.use((_client, next) =>
      next(
        this.registry.enabled
          ? undefined
          : new Error('终端仅在已认证的 Alune 服务中可用。请使用桌面版。'),
      ),
    );
  }
  handleDisconnect(client: Socket) {
    this.terminals.disconnect(client);
  }
  private reply<T>(operation: () => T): TerminalReply<T> {
    try {
      return { ok: true, value: operation() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '终端操作失败。',
      };
    }
  }
  @SubscribeMessage('terminal:create')
  create(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(() => this.terminals.create(client, body));
  }
  @SubscribeMessage('terminal:input')
  input(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(() => this.terminals.input(client, body));
  }
  @SubscribeMessage('terminal:resize')
  resize(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(() => this.terminals.resize(client, body));
  }
  @SubscribeMessage('terminal:ack')
  ack(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(() => this.terminals.ack(client, body));
  }
  @SubscribeMessage('terminal:close')
  close(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(() => this.terminals.close(client, body));
  }
}
