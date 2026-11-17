import type { JsonValue } from '@alune/protocol';
import type { ResourceRef } from '@alune/domain';

export interface EventPublisher {
  subscribed(type: string): boolean;
  failStream(error: Error): void;
  notifyState(type: string, payload: JsonValue, resource?: ResourceRef): void;
  write(
    type: string,
    payload: JsonValue,
    resource?: ResourceRef,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface HandlerContext {
  /** Set only by the authenticated UI host, never taken from request parameters. */
  workspaceRenderer?: true;
  agentId: string;
  sessionId: string;
  sessionSignal: AbortSignal;
  taskId: string;
  signal: AbortSignal;
  events: EventPublisher;
}
export interface Handler {
  minimumProtocolMinor?: number;
  operationId?(params: JsonValue | undefined): string;
  effect: 'query' | 'mutation';
  // Diagnostic telemetry can be session-scoped; business mutations stay durable.
  durable?: boolean;
  // Shape validation is synchronous. I/O belongs in run under task cancellation.
  validate(params: JsonValue | undefined): void;
  run(params: JsonValue | undefined, context: HandlerContext): JsonValue | Promise<JsonValue>;
}
