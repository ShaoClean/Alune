import { isRecord, validId, ProtocolError, type JsonValue } from '@alune/protocol';
import type { Handler } from '../ports/handler';
import type { hostsKernel } from './hosts';
import type { repositoriesKernel } from './repositories-kernel';
import type { settingsKernel } from './settings-kernel';

// Removal concerns the local workspace registration; never delete a remote
// worktree or its Git state when a server is removed from the sidebar.
export function workspaceRemoval(
  repos: ReturnType<typeof repositoriesKernel>,
  hosts: ReturnType<typeof hostsKernel>,
  settings: ReturnType<typeof settingsKernel>,
): Handler {
  return {
    effect: 'mutation',
    validate(p) {
      if (
        !isRecord(p) ||
        !['host', 'repository'].includes(String(p.kind)) ||
        !validId(p.id) ||
        !Array.isArray(p.sessions) ||
        p.sessions.length > 128 ||
        !p.sessions.every(validId) ||
        (p.kind === 'host' &&
          (!validId(p.revision) ||
            !Array.isArray(p.repositories) ||
            !p.repositories.every(validId)))
      )
        throw new ProtocolError('invalid-params', 'Invalid workspace removal');
    },
    run(p, c) {
      const input = p as unknown as {
        kind: 'host' | 'repository';
        id: string;
        sessions: string[];
        revision: string;
        repositories: string[];
      };
      const host = input.kind === 'host',
        id = input.id;
      const rows = host
        ? repos.catalog.list().filter((r) => r.connectionId === id)
        : [repos.catalog.get({ agentId: c.agentId, resourceId: id }, false)];
      const bindings = rows
        .map((r) => repos.catalog.hostBinding(r.id))
        .filter((b) => b !== undefined);
      const remoteSessions = hosts
        .remoteTerminals()
        .filter((s) =>
          host
            ? s.connectionId === id
            : bindings.some(
                (b) => b.hostId === s.connectionId && b.resource.resourceId === s.repositoryId,
              ),
        );
      const localSessions = host ? [] : repos.terminals.registry.impact({ repositoryId: id });
      const sessions = [...localSessions, ...remoteSessions];
      if (sessions.some((s) => !input.sessions.includes(s.id)))
        throw new ProtocolError(
          'conflict',
          '请确认关闭关联的终端会话。',
          'not-started',
          JSON.parse(JSON.stringify({ code: 'TERMINAL_CONFIRM_REQUIRED', sessions })),
        );
      if (remoteSessions.length && !host)
        throw new ProtocolError('busy', '请先关闭远程终端，再移除仓库。');
      if (host && hosts.activeWrites().some((w) => w.hostId === id))
        throw new ProtocolError('busy', '服务器仍有写入任务，请等待结束。');
      if (host) {
        settings.hosts.delete(id, input.revision, input.repositories);
        hosts.invalidate(id);
        c.events.notifyState('accounts.hosts.changed', { section: 'hosts' });
      } else {
        repos.terminals.registry.remove({ repositoryId: id }, input.sessions);
        repos.catalog.unregister(rows[0].resource);
      }
      for (const row of rows)
        c.events.notifyState('repositories.changed', { removed: true }, row.resource);
      return { removedIds: rows.map((r) => r.id) } as JsonValue;
    },
  };
}
