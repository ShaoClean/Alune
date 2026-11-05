import { supervisedTerminal } from '@alune/agent/supervised-pty';
import { Injectable } from '@nestjs/common';
import { hostname } from 'node:os';
import { TerminalSessions } from '@alune/agent/terminals';
import { RepositoryService } from '../repository/repository.service';
import { ConnectionService } from '../connection/connection.service';
import { TerminalRegistry } from './terminal-registry';
import { localTerminal, sshTerminal } from './terminal-transport';
export { validTerminalId, type TerminalOwner } from '@alune/agent/terminals';

@Injectable()
export class TerminalService extends TerminalSessions {
  constructor(
    repositories: RepositoryService,
    connections: ConnectionService,
    registry: TerminalRegistry,
  ) {
    super(async (id, owner) => {
      const repo = await repositories.get(id);
      const config =
        repo.source === 'local'
          ? undefined
          : await connections.get(repo.connectionId!);
      return {
        repositoryName: repo.name,
        initialPath: repo.path,
        source: repo.source || 'ssh',
        connectionId: repo.connectionId,
        environment: config
          ? `SSH · ${config.name} · ${config.username}@${config.host}`
          : registry.desktop
            ? '本机'
            : `Alune 服务主机 · ${hostname()}`,
        open: async (cols, rows, signal, callbacks) =>
          repo.source === 'local'
            ? (owner.protocolSession ? supervisedTerminal : localTerminal)(
                repo.path,
                cols,
                rows,
                signal,
                callbacks,
              )
            : sshTerminal(
                await connections.ensureConnected(repo.connectionId!),
                repo.path,
                cols,
                rows,
                signal,
                callbacks,
              ),
      };
    }, registry);
  }
}
