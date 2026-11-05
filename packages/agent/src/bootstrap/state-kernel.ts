import { proxyTest } from './proxy-test';
import { snapshotHandler } from '../modules/hosts/snapshot';
import { hostsKernel } from './hosts';
import type { LegacyRepositoryReads } from '../ports/legacy-repository-reads';
import { collaborationKernel } from './collaboration';
import type { DatabaseBackupReceipt } from '@alune/protocol';
import { validateEmpty, ProtocolError } from '@alune/protocol';
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
  remote?: { gitProxyPort?: number | 'blocked' },
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
        if (remote?.gitProxyPort === 'blocked')
          throw new ProtocolError(
            'unavailable',
            'Remote Git proxy forwarding was denied; direct access is disabled',
          );
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
  const hosts = remote
    ? undefined
    : hostsKernel(directory, repositories.catalog, settings, state.document('ssh-routes'));
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
    legacyReads ?? hosts?.reads,
  );
  const handlers: Record<string, Handler> = {
    ...hosts?.handlers,
    ...(hosts
      ? { 'network.testProxy': proxyTest(settings, network, hosts, repositories.catalog) }
      : {}),
    ...(remote ? { 'repositories.hostRead': snapshotHandler(repositories.catalog, connect) } : {}),
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
    desktopHandlers: {
      'desktop.log': {
        effect: 'mutation',
        durable: false,
        validate(p) {
          if (
            !p ||
            typeof p !== 'object' ||
            Array.isArray(p) ||
            !['INFO', 'DEBUG', 'WARN', 'ERROR'].includes(String(p.level)) ||
            typeof p.source !== 'string' ||
            typeof p.message !== 'string'
          )
            throw new ProtocolError('invalid-params', 'Invalid desktop log');
        },
        run(p) {
          const { level, source, message, context } = p as any;
          diagnostics.logs.write(level, source, message, context);
          return null;
        },
      },
      'desktop.terminals.impact': {
        effect: 'query',
        validate: validateEmpty,
        run: () => JSON.parse(JSON.stringify(repositories.terminals.registry.impact({}))),
      },
      'desktop.terminals.remove': {
        effect: 'mutation',
        durable: false,
        validate(p) {
          if (
            !Array.isArray(p) ||
            p.length > 128 ||
            !p.every((id) => typeof id === 'string' && id.length <= 128)
          )
            throw new ProtocolError('invalid-params', 'Invalid terminal confirmation');
        },
        run(ids) {
          repositories.terminals.registry.remove({}, ids);
          return null;
        },
      },
    } satisfies Record<string, Handler>,
    disconnect(sessionId: string) {
      repositories.terminals.disconnect(sessionId);
      hosts?.disconnect(sessionId);
    },
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
