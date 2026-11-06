import { isRecord, ProtocolError, validId } from './messages';

export type DirectoryAccess = 'read' | 'read-write';
export type DirectoryGrant = {
  id: string;
  agentId: string;
  path: string;
  access: DirectoryAccess;
  lifetime: 'session';
};
export type DirectoryGrantRef = Pick<DirectoryGrant, 'id' | 'agentId'>;
export const FILE_ACCESS_MAX_BYTES = 4 * 1024 * 1024;
export function validateFileAccess(method: string, value: unknown): void {
  if (!isRecord(value))
    throw new ProtocolError('invalid-params', 'Expected file access parameters');
  const text = (v: unknown) => typeof v === 'string' && v.length <= 32768 && !v.includes('\0');
  if (method === 'grant') {
    if (
      !text(value.path) ||
      !value.path ||
      !['read', 'read-write'].includes(String(value.access)) ||
      value.confirmed !== true
    )
      throw new ProtocolError('invalid-params', 'Confirm a directory and its access level');
    return;
  }
  if (method === 'grants') {
    if (Object.keys(value).length)
      throw new ProtocolError('invalid-params', 'Expected no parameters');
    return;
  }
  if (!isRecord(value.grant) || !validId(value.grant.id) || !validId(value.grant.agentId))
    throw new ProtocolError('invalid-params', 'Expected a directory grant');
  if (method === 'revoke') return;
  if (!text(value.path)) throw new ProtocolError('invalid-params', 'Expected a relative file path');
  if (
    method === 'write' &&
    (typeof value.content !== 'string' ||
      value.content.length > FILE_ACCESS_MAX_BYTES ||
      typeof value.version !== 'string' ||
      !/^(missing|[a-f0-9]{64})$/.test(value.version))
  )
    throw new ProtocolError('invalid-params', 'Expected text and its last read version');
}
