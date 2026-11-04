import { basename } from 'node:path';
import { ProtocolError, validateEmpty } from '@alune/protocol';
import { AgentState } from '../adapters/sqlite/state';
import { StateFault } from '../ports/state';
import type { Handler } from '../ports/handler';
import type { DatabaseBackupReceipt } from '@alune/protocol';

export async function openStateKernel(directory: string, agentId: string, signal?: AbortSignal) {
  const state = await AgentState.open(directory, agentId, signal);
  const handlers: Record<string, Handler> = {
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
            const kinds = {
              busy: 'busy',
              conflict: 'conflict',
              permission: 'permission-denied',
              corrupt: 'state-corrupt',
              unavailable: 'unavailable',
            } as const;
            throw new ProtocolError(kinds[error.kind], error.message);
          }
          throw error;
        }
      },
    },
  };
  return { state, handlers, close: () => state.close() };
}
