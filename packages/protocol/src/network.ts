import { isRecord, ProtocolError, validId } from './messages';

export type UpdaterBridge = {
  agentId: string;
  scope: 'agent-loopback';
  port: number;
  revision: string;
  enabled: boolean;
};
export function validateUpdaterBridge(value: unknown): UpdaterBridge {
  if (
    !isRecord(value) ||
    !validId(value.agentId) ||
    value.scope !== 'agent-loopback' ||
    !Number.isInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65535 ||
    !validId(value.revision) ||
    typeof value.enabled !== 'boolean'
  )
    throw new ProtocolError('invalid-request', 'Invalid updater bridge');
  return value as UpdaterBridge;
}
