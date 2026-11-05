import { hostsKernel } from './hosts';
import type { LegacyRepositoryReads } from '../ports/legacy-repository-reads';
import { collaborationKernel } from './collaboration';
import type { DatabaseBackupReceipt } from '@alune/protocol';
import { validateEmpty } from '@alune/protocol';
import { basename } from 'node:path';
import { NativeRepositoryConnection } from '../adapters/git/native';
import { ProxyRuntime } from '../adapters/network/runtime';
import type { ProtectedSecretOptions } from '../adapters/secrets/protected';
import { AgentState } from '../adapters/sqlite/state';
import { diagnosticLogs } from '../modules/diagnostics/logs';
import type { Handler } from '../ports/handler';
import { StateFault } from '../ports/state';
import { stateFailure } from '../server/errors';
import { repositoriesKernel } from './repositories-kernel';
import { settingsKernel } from './settings-kernel';

export async function openStateKernel(
  directory: string,
  agentId: string,
  signal?: AbortSignal,
  secretOptions: Pick<ProtectedSecretOptions, 'backend' | 'keychain'> = {},
  legacyReads?: LegacyRepositoryReads,
  remote?: { gitProxyPort?: number },
) {
  const state = await AgentState.open(directory, agentId, signal);
  let settings: ReturnType<typeof settingsKernel>;
  try {
    settings = settingsKernel(state, directory, agentId, secretOptions);
  } catch (error) {
    await state.close();
    throw error;
  }
  let diagnostics: ReturnType<typeof diagnosticLogs>;
  try {
    diagnostics = diagnosticLogs(directory, state.document('logging-settings'));
  } catch (error) {
    await settings.close();
    await state.close();
    throw error;
  }
  const connect = async (signal: AbortSignal, write = false) =>
    new NativeRepositoryConnection(
      signal,
      async () => {
        // Offline Git/file reads must not require unrelated AI/account keys.
        // The native adapter invokes this only for network/lazy-object reads.
        if (remote?.gitProxyPort)
          return {
            enabled: true,
            revision: 'ssh-session',
            host: '127.0.0.1',
            port: remote.gitProxyPort,
            protocol: 'http' as const,
          };
        const config = settings.proxy.read();
        if (config.enabled && config.authEnabled) await settings.readyCredentials(signal);
        return settings.proxy.snapshot();
      },
      !write,
      () => {
        try {
          return !!remote?.gitProxyPort || settings.proxy.read().enabled;
        } catch {
          return undefined;
        } // Corrupt policy is not permission to go direct.
      },
    );
  const repositories = repositoriesKernel(state.database, agentId, connect);
  const network = new ProxyRuntime(settings.proxy);
  const collaboration = collaborationKernel(
    repositories.catalog,
    settings,
    connect,
    network.fetch,
    async (source, method, url, _context, send) => {
      const response = await send();
      diagnostics.logs.write(
        response.ok ? 'INFO' : 'WARN',
        source,
        method + ' ' + new URL(url).host,
        { status: response.status },
      );
      return response;
    },
    legacyReads,
  );
  const hosts = remote
    ? undefined
    : hostsKernel(directory, repositories.catalog, settings, state.document('ssh-routes'));
  const handlers: Record<string, Handler> = {
    ...hosts?.handlers,
    ...collaboration,
    ...repositories.handlers,
    ...settings.handlers,
    ...diagnostics.handlers,
    'network.updaterBridge': {
      minimumProtocolMinor: 1,
      effect: 'mutation',
      validate: validateEmpty,
      async run(_params, context) {
        await settings.readyCredentials(context.signal);
        context.signal.throwIfAborted();
        return { ...(await network.updaterBridge()), agentId, scope: 'agent-loopback' };
      },
    },
    'storage.status': {
      minimumProtocolMinor: 1,
      effect: 'query',
      validate: validateEmpty,
      run: () => state.status(),
    },
    'storage.backupDatabase': {
      minimumProtocolMinor: 1,
      effect: 'mutation',
      validate: validateEmpty,
      async run(_params, context): Promise<DatabaseBackupReceipt> {
        try {
          const folder = await state.backup(context.signal);
          return { backupId: basename(folder), scope: 'database-only', agentId };
        } catch (error) {
          if (error instanceof StateFault) {
            throw stateFailure(error);
          }
          throw error;
        }
      },
    },
  };
  // A profile or proxy change retires even an in-flight handshake with the old destination.
  if (hosts)
    for (const method of ['accounts.hosts.save', 'accounts.hosts.delete', 'settings.proxy.save']) {
      const original = handlers[method];
      handlers[method] = {
        ...original,
        async run(params, ctx) {
          const result = await original.run(params, ctx);
          const id = (params as { id?: string }).id;
          if (method === 'settings.proxy.save' || id) hosts.invalidate(id);
          return result;
        },
      };
    }
  return {
    state,
    handlers,
    taskJournal: state.taskJournal(),
    close: async () => {
      try {
        hosts?.close();
        await repositories.close();
        await network.close();
      } finally {
        try {
          await settings.close();
        } finally {
          try {
            diagnostics.close();
          } finally {
            await state.close();
          }
        }
      }
    },
  };
}
