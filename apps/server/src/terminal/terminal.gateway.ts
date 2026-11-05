import { randomUUID } from 'node:crypto';
import { AgentSession } from '@alune/agent';
import { terminalHandlers } from '@alune/agent/terminals';
import { terminalChannel } from '@alune/agent-client';
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
  // A temporary host for the opt-in desktop route; persistent stdio Agents use
  // their stored agentId. Both routes use the same owner/registry/PTY handlers.
  private readonly hostId = randomUUID();
  handleConnection(client: Socket) {
    if (client.handshake.auth?.terminalProtocol !== 1) return;
    const session = new AgentSession(terminalChannel(client), {
      agentId: this.hostId,
      version: '1',
      handlers: terminalHandlers(this.terminals),
      onDispose: async () =>
        this.terminals.disconnect({
          id: session.sessionId,
          connected: false,
          emit() {},
        }),
    });
  }
  handleDisconnect(client: Socket) {
    this.terminals.disconnect(client);
  }
  private reply<T>(client: Socket, operation: () => T): TerminalReply<T> {
    try {
      if (client.handshake.auth?.terminalProtocol === 1)
        throw new Error('当前窗口使用 Agent 终端协议。');
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
    return this.reply(client, () => this.terminals.create(client, body));
  }
  @SubscribeMessage('terminal:input')
  input(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(client, () => this.terminals.input(client, body));
  }
  @SubscribeMessage('terminal:resize')
  resize(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(client, () => this.terminals.resize(client, body));
  }
  @SubscribeMessage('terminal:ack')
  ack(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(client, () => this.terminals.ack(client, body));
  }
  @SubscribeMessage('terminal:close')
  close(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    return this.reply(client, () => this.terminals.close(client, body));
  }
}
