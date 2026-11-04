import type { ResourceRef } from '@alune/domain';

export const PROTOCOL_VERSION = Object.freeze({ major: 1, minor: 0 });
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const MAX_EVENT_QUEUE_BYTES = 1024 * 1024;
export const MAX_EVENT_QUEUE_LENGTH = 256;
export const MAX_STREAM_CHUNK_BYTES = 64 * 1024;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type Outcome = 'not-started' | 'completed' | 'unknown';
export type ErrorKind =
  | 'parse'
  | 'invalid-request'
  | 'invalid-params'
  | 'unknown-method'
  | 'not-initialized'
  | 'incompatible-version'
  | 'cancelled'
  | 'overloaded'
  | 'duplicate-request'
  | 'disconnected'
  | 'timeout'
  | 'internal';
export const ERROR_CODES: Readonly<Record<ErrorKind, number>> = Object.freeze({
  parse: -32700,
  'invalid-request': -32600,
  'invalid-params': -32602,
  'unknown-method': -32601,
  'not-initialized': -32000,
  'incompatible-version': -32001,
  cancelled: -32800,
  overloaded: -32002,
  'duplicate-request': -32003,
  disconnected: -32004,
  timeout: -32005,
  internal: -32603,
});
export interface RpcError {
  code: number;
  message: string;
  data: { kind: ErrorKind; outcome: Outcome; details?: JsonValue };
}
export interface RpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: JsonValue;
}
export interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: JsonValue;
}
export type RpcResponse =
  | { jsonrpc: '2.0'; id: string; result: JsonValue }
  | { jsonrpc: '2.0'; id: string | null; error: RpcError };
export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;
export interface AgentEvent {
  agentId: string;
  sessionId: string;
  sequence: number;
  type: string;
  resource?: ResourceRef;
  payload: JsonValue;
}

export class ProtocolError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly outcome: Outcome = 'not-started',
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
  toRpcError(): RpcError {
    return {
      code: ERROR_CODES[this.kind],
      message: this.message,
      data: { kind: this.kind, outcome: this.outcome },
    };
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
function jsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => jsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => jsonValue(item, depth + 1));
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function validError(value: unknown): value is RpcError {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.code) &&
    typeof value.message === 'string' &&
    value.message.length <= 4096 &&
    isRecord(value.data) &&
    typeof value.data.kind === 'string' &&
    Object.hasOwn(ERROR_CODES, value.data.kind) &&
    ['not-started', 'completed', 'unknown'].includes(String(value.data.outcome)) &&
    jsonValue(value)
  );
}
export function parseMessage(text: string): RpcMessage {
  if (new TextEncoder().encode(text).byteLength > MAX_FRAME_BYTES)
    throw new ProtocolError('invalid-request', 'Protocol frame exceeds byte limit');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProtocolError('parse', 'Invalid JSON');
  }
  if (!isRecord(value) || value.jsonrpc !== '2.0' || !jsonValue(value))
    throw new ProtocolError('invalid-request', 'Invalid JSON-RPC message');
  if (Object.hasOwn(value, 'method')) {
    if (
      typeof value.method !== 'string' ||
      !/^[A-Za-z_$][A-Za-z0-9_.$:/-]{0,127}$/.test(value.method) ||
      !onlyKeys(value, ['jsonrpc', 'id', 'method', 'params']) ||
      (Object.hasOwn(value, 'id') && !validId(value.id))
    )
      throw new ProtocolError('invalid-request', 'Invalid request');
  } else if (Object.hasOwn(value, 'result')) {
    if (!validId(value.id) || !onlyKeys(value, ['jsonrpc', 'id', 'result']))
      throw new ProtocolError('invalid-request', 'Invalid result response');
  } else if (Object.hasOwn(value, 'error')) {
    if (
      (value.id !== null && !validId(value.id)) ||
      !validError(value.error) ||
      !onlyKeys(value, ['jsonrpc', 'id', 'error'])
    )
      throw new ProtocolError('invalid-request', 'Invalid error response');
  } else throw new ProtocolError('invalid-request', 'Message has no method, result or error');
  return value as unknown as RpcMessage;
}
export function encodeMessage(message: RpcMessage): string {
  if (!jsonValue(message))
    throw new ProtocolError('invalid-request', 'Message must contain only finite JSON values');
  const text = JSON.stringify(message);
  parseMessage(text);
  return text + '\n';
}
export function parseEvent(value: unknown): AgentEvent {
  if (
    !isRecord(value) ||
    !validId(value.agentId) ||
    !validId(value.sessionId) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    typeof value.type !== 'string' ||
    value.type.length < 1 ||
    value.type.length > 128 ||
    !Object.hasOwn(value, 'payload') ||
    !jsonValue(value) ||
    (value.resource !== undefined &&
      (!isRecord(value.resource) ||
        !validId(value.resource.agentId) ||
        !validId(value.resource.resourceId) ||
        value.resource.agentId !== value.agentId))
  )
    throw new ProtocolError('invalid-params', 'Invalid Agent event');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_STREAM_CHUNK_BYTES)
    throw new ProtocolError('invalid-params', 'Agent event exceeds stream chunk limit');
  return value as unknown as AgentEvent;
}
