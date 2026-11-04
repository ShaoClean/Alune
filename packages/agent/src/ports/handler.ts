import type { JsonValue } from '@alune/protocol';
import type { ResourceRef } from '@alune/domain';

export interface EventPublisher {
  notifyState(type: string, payload: JsonValue, resource?: ResourceRef): void;
  write(
    type: string,
    payload: JsonValue,
    resource?: ResourceRef,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface HandlerContext {
  agentId: string;
  sessionId: string;
  taskId: string;
  signal: AbortSignal;
  events: EventPublisher;
}
export interface Handler {
  minimumProtocolMinor?: number;
  effect: 'query' | 'mutation';
  // Shape validation is synchronous. I/O belongs in run under task cancellation.
  validate(params: JsonValue | undefined): void;
  run(params: JsonValue | undefined, context: HandlerContext): JsonValue | Promise<JsonValue>;
}
