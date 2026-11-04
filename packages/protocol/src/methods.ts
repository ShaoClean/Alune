import { isRecord, ProtocolError, PROTOCOL_VERSION, validId } from './messages';

export const CORE_CAPABILITIES = [
  'agent.health',
  'agent.version',
  'agent.capabilities',
  'requests.cancel',
  'events.subscribe',
  'events.ack',
  'tasks.get',
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
    !value.capabilities.every(
      (cap) => typeof cap === 'string' && cap.length > 0 && cap.length <= 128,
    )
  )
    throw new ProtocolError('incompatible-version', 'Invalid initialize response');
  return value as unknown as InitializeResult;
}
export function validateEmpty(value: unknown): void {
  if (value !== undefined && (!isRecord(value) || Object.keys(value).length !== 0))
    throw new ProtocolError('invalid-params', 'This method takes no parameters');
}

export interface HealthResult {
  status: 'ok';
  agentId: string;
  sessionId: string;
  lifecycle: 'session';
}
export interface VersionResult {
  version: string;
  protocol: { major: number; minor: number };
}
export interface CapabilitiesResult {
  capabilities: string[];
}
export interface SubscriptionResult {
  subscribed: string[];
  sessionId: string;
}
export interface TaskInfo {
  taskId: string;
  requestId: string;
  method: string;
  effect: 'query' | 'mutation';
  state: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  outcome: 'not-started' | 'completed' | 'unknown';
  startedAt: number;
  finishedAt?: number;
}
export type TaskQuery =
  | { requestId: string; taskId?: never }
  | { taskId: string; requestId?: never };
export interface TaskResult {
  scope: 'session';
  task: TaskInfo | null;
}
const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 1024 &&
  value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 128);
export function validateHealth(value: unknown): HealthResult {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    !validId(value.agentId) ||
    !validId(value.sessionId) ||
    value.lifecycle !== 'session'
  )
    throw new ProtocolError('invalid-request', 'Invalid health response');
  return value as unknown as HealthResult;
}
export function validateVersion(value: unknown): VersionResult {
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    !value.version ||
    value.version.length > 128 ||
    !isRecord(value.protocol) ||
    value.protocol.major !== PROTOCOL_VERSION.major ||
    !Number.isSafeInteger(value.protocol.minor) ||
    Number(value.protocol.minor) < 0
  )
    throw new ProtocolError('invalid-request', 'Invalid version response');
  return value as unknown as VersionResult;
}
export function validateCapabilities(value: unknown): CapabilitiesResult {
  if (!isRecord(value) || !stringList(value.capabilities))
    throw new ProtocolError('invalid-request', 'Invalid capabilities response');
  return value as unknown as CapabilitiesResult;
}
export function validateSubscription(value: unknown): SubscriptionResult {
  if (!isRecord(value) || !stringList(value.subscribed) || !validId(value.sessionId))
    throw new ProtocolError('invalid-request', 'Invalid subscription response');
  return value as unknown as SubscriptionResult;
}
export function validateTaskQuery(value: unknown): TaskQuery {
  if (
    !isRecord(value) ||
    Object.hasOwn(value, 'requestId') === Object.hasOwn(value, 'taskId') ||
    !validId(Object.hasOwn(value, 'requestId') ? value.requestId : value.taskId)
  )
    throw new ProtocolError('invalid-params', 'Supply exactly one taskId or requestId');
  return value as unknown as TaskQuery;
}
export function validateTaskResult(value: unknown): TaskResult {
  if (!isRecord(value) || value.scope !== 'session')
    throw new ProtocolError('invalid-request', 'Invalid task scope');
  const t = value.task;
  if (
    t !== null &&
    (!isRecord(t) ||
      !validId(t.taskId) ||
      !validId(t.requestId) ||
      typeof t.method !== 'string' ||
      !['query', 'mutation'].includes(String(t.effect)) ||
      !['running', 'succeeded', 'failed', 'cancelled', 'unknown'].includes(String(t.state)) ||
      !['not-started', 'completed', 'unknown'].includes(String(t.outcome)) ||
      !Number.isFinite(t.startedAt) ||
      (t.finishedAt !== undefined && !Number.isFinite(t.finishedAt)))
  )
    throw new ProtocolError('invalid-request', 'Invalid task response');
  return value as unknown as TaskResult;
}
