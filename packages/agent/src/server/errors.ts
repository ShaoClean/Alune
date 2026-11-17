import { ProtocolError } from '@alune/protocol';
import { StateFault } from '../ports/state';

export function stateFailure(error: StateFault): ProtocolError {
  const kinds = {
    busy: 'busy',
    corrupt: 'state-corrupt',
    conflict: 'conflict',
    permission: 'permission-denied',
    unavailable: 'unavailable',
    'invalid-input': 'invalid-params',
    'not-found': 'not-found',
  } as const;
  return new ProtocolError(kinds[error.kind], error.message, error.outcome);
}
