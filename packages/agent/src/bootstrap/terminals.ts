import { hostname } from 'node:os';
import { terminalHandlers } from '../modules/terminals/handlers';
import { ProtocolError } from '@alune/protocol';
import { TerminalRegistry, TerminalSessions } from '../modules/terminals';
import type { RepositoryCatalog } from '../modules/repositories/catalog';
import { supervisedTerminal } from '../adapters/pty/supervised';

export function terminalsKernel(catalog: RepositoryCatalog) {
  const registry = new TerminalRegistry((message) => new ProtocolError('conflict', message));
  registry.enabled = true;
  const sessions = new TerminalSessions(async (resourceId) => {
    const repo = catalog.get({ agentId: catalog.agentId, resourceId });
    return {
      repositoryName: repo.name,
      initialPath: repo.path,
      source: 'local',
      environment: `Alune 服务主机 · ${hostname()}`,
      open: (cols, rows, signal, callbacks) =>
        supervisedTerminal(repo.path, cols, rows, signal, callbacks),
    };
  }, registry);
  return {
    handlers: terminalHandlers(sessions, (r) => catalog.get(r)),
    registry,
    disconnect: (id: string) => sessions.disconnect({ id }),
    close: () => sessions.onModuleDestroy(),
  };
}
