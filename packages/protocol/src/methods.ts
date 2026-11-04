import { isRecord, ProtocolError, PROTOCOL_VERSION, validId } from './messages';

export const CORE_CAPABILITIES = [
  'agent.health',
  'agent.version',
  'agent.capabilities',
  'requests.cancel',
  'events.subscribe',
  'events.ack',
] as const;
export interface InitializeParams {
  protocol: { major: number; minor: number };
  client: { name: string; version: string };
}
export interface InitializeResult {
  protocol: { major: number; minor: number };
  agentId: string;
  sessionId: string;
  implementation: { name: string; version: string };
  capabilities: string[];
  lifecycle: 'session';
}
export function validateInitialize(value: unknown): InitializeParams {
  if (
    !isRecord(value) ||
    !isRecord(value.protocol) ||
    !isRecord(value.client) ||
    !Number.isSafeInteger(value.protocol.major) ||
    Number(value.protocol.major) < 0 ||
    !Number.isSafeInteger(value.protocol.minor) ||
    Number(value.protocol.minor) < 0 ||
    typeof value.client.name !== 'string' ||
    !value.client.name.trim() ||
    value.client.name.length > 128 ||
    typeof value.client.version !== 'string' ||
    !value.client.version ||
    value.client.version.length > 128
  )
    throw new ProtocolError('invalid-params', 'initialize requires protocol and client versions');
  if (value.protocol.major !== PROTOCOL_VERSION.major)
    throw new ProtocolError('incompatible-version', 'Unsupported protocol major version');
  return value as unknown as InitializeParams;
}
export function validateInitialized(value: unknown): InitializeResult {
  if (
    !isRecord(value) ||
    !validId(value.agentId) ||
    !validId(value.sessionId) ||
    !isRecord(value.protocol) ||
    value.protocol.major !== PROTOCOL_VERSION.major ||
    !Number.isSafeInteger(value.protocol.minor) ||
    Number(value.protocol.minor) < 0 ||
    !isRecord(value.implementation) ||
    typeof value.implementation.name !== 'string' ||
    typeof value.implementation.version !== 'string' ||
    value.lifecycle !== 'session' ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > 1024 ||
    !value.capabilities.every((cap) => typeof cap === 'string' && cap.length <= 128)
  )
    throw new ProtocolError('incompatible-version', 'Invalid initialize response');
  return value as unknown as InitializeResult;
}
export function validateEmpty(value: unknown): void {
  if (value !== undefined && (!isRecord(value) || Object.keys(value).length !== 0))
    throw new ProtocolError('invalid-params', 'This method takes no parameters');
}
