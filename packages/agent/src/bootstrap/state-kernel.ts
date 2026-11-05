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
  const repositories = repositoriesKernel(
    state.database,
    agentId,
    async (signal) =>
      new NativeRepositoryConnection(
        signal,
        async () => {
          // Offline Git/file reads must not require unrelated AI/account keys.
          // The native adapter invokes this only for network/lazy-object reads.
          const config = settings.proxy.read();
          if (config.enabled && config.authEnabled) await settings.readyCredentials(signal);
          return settings.proxy.snapshot();
        },
        true,
      ),
  );
  const handlers: Record<string, Handler> = {
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
  const network = new ProxyRuntime(settings.proxy);
  return {
    state,
    handlers,
    taskJournal: state.taskJournal(),
    close: async () => {
      try {
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
