import { isRecord, ProtocolError, validId } from './messages';

export type StorageStatus = {
  agentId: string;
  schemaVersion: number;
  generation: string;
  writer: boolean;
};
export type DatabaseBackupReceipt = { agentId: string; backupId: string; scope: 'database-only' };
export function validateStorageStatus(value: unknown): StorageStatus {
  if (
    !isRecord(value) ||
    !validId(value.agentId) ||
    !validId(value.generation) ||
    !Number.isSafeInteger(value.schemaVersion) ||
    Number(value.schemaVersion) < 1 ||
    typeof value.writer !== 'boolean'
  )
    throw new ProtocolError('invalid-request', 'Invalid storage status');
  return value as StorageStatus;
}
export function validateDatabaseBackupReceipt(value: unknown): DatabaseBackupReceipt {
  if (
    !isRecord(value) ||
    !validId(value.agentId) ||
    !validId(value.backupId) ||
    value.scope !== 'database-only'
  )
    throw new ProtocolError('invalid-request', 'Invalid database backup receipt');
  return value as DatabaseBackupReceipt;
}
