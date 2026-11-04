import { basename } from 'node:path';
import { ProtocolError, validateEmpty } from '@alune/protocol';
import { AgentState } from '../adapters/sqlite/state';
import { StateFault } from '../ports/state';
import { stateFailure } from '../server/errors';
import type { Handler } from '../ports/handler';
import type { DatabaseBackupReceipt } from '@alune/protocol';
import { settingsKernel } from './settings-kernel';
import type { ProtectedSecretOptions } from '../adapters/secrets/protected';

export async function openStateKernel(
  directory: string,
  agentId: string,
  signal?: AbortSignal,
  secretOptions: Pick<ProtectedSecretOptions, 'backend' | 'keychain'> = {},
) {
  const state = await AgentState.open(directory, agentId, signal);
  const settings = settingsKernel(state, directory, agentId, secretOptions);
  const handlers: Record<string, Handler> = {
    ...settings.handlers,
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
  return {
    state,
    handlers,
    taskJournal: state.taskJournal(),
    close: async () => {
      await settings.close();
      await state.close();
    },
  };
}
