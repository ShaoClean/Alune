import { ProtocolError } from '@alune/protocol';

type LegacyFailure = { response?: { status?: number; data?: { code?: string } } };

export function repositoryFileStatus(error: unknown): number | undefined {
  if (error instanceof ProtocolError) {
    if (error.kind === 'not-found') return 404;
    if (error.kind === 'permission-denied') return 403;
    return undefined;
  }
  return (error as LegacyFailure | null)?.response?.status;
}

export function repositoryHistoryChanged(error: unknown): boolean {
  if (error instanceof ProtocolError) {
    const detail = error.details;
    return (
      error.kind === 'conflict' &&
      !!detail &&
      typeof detail === 'object' &&
      'code' in detail &&
      detail.code === 'HISTORY_CHANGED'
    );
  }
  return (error as LegacyFailure | null)?.response?.data?.code === 'HISTORY_CHANGED';
}
