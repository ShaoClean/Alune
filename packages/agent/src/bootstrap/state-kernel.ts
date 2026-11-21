import { workspaceRemoval } from './workspace-removal';
import { proxyTest } from './proxy-test';
import { snapshotHandler } from '../modules/hosts/snapshot';
import { hostsKernel } from './hosts';
import { collaborationKernel } from './collaboration';
import type { DatabaseBackupReceipt } from '@alune/protocol';
import { validateEmpty, ProtocolError } from '@alune/protocol';
import { basename } from 'node:path';
import { NativeRepositoryConnection } from '../adapters/git/native';
import { ProxyRuntime } from '../adapters/network/runtime';
import { createHttpTracer } from '../adapters/logging/http-trace';
import type { ProtectedSecretOptions } from '../adapters/secrets/protected';
import { AgentState } from '../adapters/sqlite/state';
import { diagnosticLogs } from '../modules/diagnostics/logs';
import type { Handler } from '../ports/handler';
import { StateFault } from '../ports/state';
import { stateFailure } from '../server/errors';
import { repositoriesKernel } from './repositories-kernel';
import { settingsKernel } from './settings-kernel';
import { fileAccessKernel } from '../modules/files/access';

export async function openStateKernel(
  directory: string,
  agentId: string,
  signal?: AbortSignal,
  secretOptions: Pick<ProtectedSecretOptions, 'backend' | 'keychain'> = {},
  remote?: { gitProxyPort?: number | 'blocked'; activityChanged?: () => void },
) {
  const state = await AgentState.open(directory, agentId, signal);
  // Every successfully acquired resource belongs to this kernel, including
  // resources created before a later constructor rejects persisted state.
  const resources: (() => void | Promise<void>)[] = [() => state.close()];
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const failures: unknown[] = [];
      for (const release of [...resources].reverse()) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Agent state kernel cleanup failed');
    })());
  try {
    const settings = settingsKernel(state, directory, agentId, secretOptions);
    resources.push(() => settings.close());
    const diagnostics = diagnosticLogs(directory, state.document('logging-settings'));
    resources.push(() => diagnostics.close());
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
    const repositories = repositoriesKernel(
      state.database,
      agentId,
      connect,
      remote?.activityChanged,
    );
    resources.push(() => repositories.close());
    const files = fileAccessKernel(agentId);
    resources.push(() => files.close());
    const network = new ProxyRuntime(settings.proxy);
    resources.push(() => network.close());
    const hosts = remote
      ? undefined
      : hostsKernel(directory, repositories.catalog, settings, state.document('ssh-routes'));
    if (hosts) resources.push(() => hosts.close());
    const collaboration = collaborationKernel(
      repositories.catalog,
      settings,
      connect,
      network.fetch,
      createHttpTracer((...args) => diagnostics.logs.write(...args)),
      hosts?.reads,
    );
    const handlers: Record<string, Handler> = {
      ...hosts?.handlers,
      ...(hosts ? { 'workspace.remove': workspaceRemoval(repositories, hosts, settings) } : {}),
      ...(hosts
        ? { 'network.testProxy': proxyTest(settings, network, hosts, repositories.catalog) }
        : {}),
      ...(remote
        ? { 'repositories.hostRead': snapshotHandler(repositories.catalog, connect) }
        : {}),
      ...collaboration,
      ...repositories.handlers,
      ...files.handlers,
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
      for (const method of [
        'accounts.hosts.save',
        'accounts.hosts.delete',
        'settings.proxy.save',
      ]) {
        const original = handlers[method];
        handlers[method] = {
          ...original,
          async run(params, ctx) {
            const result = await original.run(params, ctx);
            const id = (params as { id?: string }).id;
            if (method === 'settings.proxy.save') hosts.proxyChanged();
            else if (id) {
              if (method === 'accounts.hosts.delete') hosts.forget(id);
              else hosts.invalidate(id);
            }
            return result;
          },
        };
      }
    return {
      state,
      activeTerminals: () => repositories.terminals.registry.impact({}).map(({ id, repositoryName }) => ({ id, repositoryName })),
      hasActiveTerminals: () => repositories.terminals.registry.impact({}).length > 0,
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
        'desktop.tasks.impact': {
          effect: 'query',
          validate: validateEmpty,
          run: () =>
            JSON.parse(
              JSON.stringify([
                ...state.database
                  .prepare("SELECT id AS requestId,method FROM operations WHERE state='running'")
                  .all(),
                ...(hosts?.activeWrites() ?? []),
              ]),
            ),
        },
        'desktop.terminals.impact': {
          effect: 'query',
          validate: validateEmpty,
          run: () =>
            JSON.parse(
              JSON.stringify([
                ...repositories.terminals.registry
                  .impact({})
                  .map((session) => ({ ...session, environment: '本机' })),
                ...(hosts?.remoteTerminals(true) ?? []),
              ]),
            ),
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
            if (
              hosts?.remoteTerminals(true).some((t) => !Array.isArray(ids) || !ids.includes(t.id))
            )
              throw new ProtocolError('conflict', '远程终端会话发生了变化，请重新确认。');
            repositories.terminals.registry.remove({}, ids);
            hosts?.closeShellRoutes();
            return null;
          },
        },
      } satisfies Record<string, Handler>,
      disconnect(sessionId: string) {
        files.disconnect(sessionId);
        repositories.terminals.disconnect(sessionId);
        hosts?.disconnect(sessionId);
      },
      handlers,
      taskJournal: state.taskJournal(),
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Agent state kernel initialization and cleanup failed',
      );
    }
    throw error;
  }
}
