import type { ResourceRef, TerminalSession } from '@alune/domain';
import { TERMINAL_LIMITS } from '@alune/domain';
import { ProtocolError, isRecord } from './messages';
import { validateResource } from './repositories';

export const TERMINAL_TOPICS = ['terminal:state', 'terminal:output', 'terminal:removed'] as const;
export interface TerminalCommands {
  create: { resource: ResourceRef; requestId: string; cols: number; rows: number };
  input: { sessionId: string; data: string };
  resize: { sessionId: string; cols: number; rows: number };
  ack: { sessionId: string; sequence: number };
  close: { sessionId: string; confirmed: boolean };
  attach: { sessionId: string };
  list: {};
}
export type TerminalCommand = keyof TerminalCommands;
const keys: Record<TerminalCommand, string[]> = {
  create: ['resource', 'requestId', 'cols', 'rows'],
  input: ['sessionId', 'data'],
  resize: ['sessionId', 'cols', 'rows'],
  ack: ['sessionId', 'sequence'],
  close: ['sessionId', 'confirmed'],
  attach: ['sessionId'],
  list: [],
};
export const validTerminalId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function validateTerminalCommand<K extends TerminalCommand>(
  command: K,
  value: unknown,
): TerminalCommands[K] {
  const bad = () =>
    new ProtocolError('invalid-params', 'Invalid terminal ' + command + ' parameters');
  if (!isRecord(value) || Object.keys(value).some((k) => !keys[command].includes(k))) throw bad();
  if (command === 'create') {
    validateResource(value.resource);
    if (!validTerminalId(value.requestId)) throw bad();
  } else if (command !== 'list' && !validTerminalId(value.sessionId)) throw bad();
  if (command === 'create' || command === 'resize') {
    if (
      !Number.isInteger(value.cols) ||
      Number(value.cols) < 2 ||
      Number(value.cols) > 500 ||
      !Number.isInteger(value.rows) ||
      Number(value.rows) < 1 ||
      Number(value.rows) > 200
    )
      throw bad();
  }
  if (
    command === 'input' &&
    (typeof value.data !== 'string' ||
      !value.data ||
      new TextEncoder().encode(value.data).length > TERMINAL_LIMITS.inputBytes)
  )
    throw bad();
  if (command === 'ack' && (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1))
    throw bad();
  if (command === 'close' && typeof value.confirmed !== 'boolean') throw bad();
  return value as unknown as TerminalCommands[K];
}

export function validateTerminalSession(value: unknown): TerminalSession {
  if (
    !isRecord(value) ||
    !validTerminalId(value.id) ||
    value.requestId !== value.id ||
    !validTerminalId(value.repositoryId) ||
    typeof value.repositoryName !== 'string' ||
    typeof value.initialPath !== 'string' ||
    typeof value.environment !== 'string' ||
    !['local', 'ssh'].includes(String(value.source)) ||
    !['connecting', 'running', 'exited', 'disconnected', 'failed'].includes(String(value.state)) ||
    !Number.isSafeInteger(value.createdAt)
  )
    throw new ProtocolError('invalid-request', 'Invalid terminal session');
  return value as unknown as TerminalSession;
}
