import { basename } from 'node:path';
import { ProtocolError, validateEmpty } from '@alune/protocol';
import { AgentState } from '../adapters/sqlite/state';
import { StateFault } from '../ports/state';
import { stateFailure } from '../server/errors';
import type { Handler } from '../ports/handler';
import type { DatabaseBackupReceipt } from '@alune/protocol';
import { settingsKernel } from './settings-kernel';
import type { ProtectedSecretOptions } from '../adapters/secrets/protected';
import { diagnosticLogs } from '../modules/diagnostics/logs';
import { ProxyRuntime } from '../adapters/network/runtime';

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
  const handlers: Record<string, Handler> = {
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
