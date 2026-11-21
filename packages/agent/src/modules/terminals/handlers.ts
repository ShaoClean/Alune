import {
  ProtocolError,
  TERMINAL_TOPICS,
  validateTerminalCommand,
  type JsonValue,
  type ResourceRef,
} from '@alune/protocol';
import { TerminalSessions, type TerminalOwner } from './sessions';
import type { Handler } from '../../ports/handler';

export function terminalHandlers(
  sessions: TerminalSessions,
  checkResource?: (resource: ResourceRef) => void,
) {
  const handlers: Record<string, Handler> = {};
  for (const command of ['create', 'attach', 'list', 'input', 'resize', 'ack', 'close'] as const) {
    if (command === 'attach' && !sessions.persistent) continue;
    handlers['terminals.' + command] = {
      minimumProtocolMinor: 4,
      effect: command === 'list' ? 'query' : 'mutation',
      durable: false,
      validate: (p) => {
        validateTerminalCommand(command, p);
      },
      run(p, c) {
        // One authenticated stdio channel per window. Never accept an owner ID or cwd on the wire.
        const owner: TerminalOwner = {
          protocolSession: true,
          id: c.sessionId,
          get connected() {
            return !c.sessionSignal.aborted;
          },
          emit() {},
          fail: (error) => c.events.failStream(error),
        };
        if (command === 'create' || command === 'attach') {
          const attachId =
            command === 'attach' ? validateTerminalCommand('attach', p).sessionId : undefined;
          const session = attachId && sessions.list(owner).find((s) => s.id === attachId);
          if (attachId && !session) throw new ProtocolError('not-found', 'Terminal ended');
          const body = session
            ? { resource: { agentId: c.agentId, resourceId: session.repositoryId } }
            : validateTerminalCommand('create', p);
          if (body.resource.agentId !== c.agentId)
            throw new ProtocolError('not-found', 'Foreign Agent resource');
          checkResource?.(body.resource);
          if (!TERMINAL_TOPICS.every((t) => c.events.subscribed(t)))
            throw new ProtocolError(
              'invalid-params',
              'Subscribe to terminal events before creating a shell',
            );
          owner.emit = (event, payload) => {
            // Stream receipt and xterm parser ACK are independent. A slow parser holds
            // only its shell; state/removal and output from other shells can still flow.
            void c.events
              // Output packets contain only strings/numbers and EventQueue
              // takes an owned copy synchronously. State events still need
              // wire() to omit optional fields whose value is undefined.
              .write(
                event,
                event === 'terminal:output' ? (payload as JsonValue) : wire(payload),
                body.resource,
              )
              .catch((error) => c.events.failStream(error));
          };
          if (attachId) return wire(invoke(() => sessions.attach(owner, attachId)));
          return wire(
            invoke(() =>
              sessions.create(owner, { ...body, repositoryId: body.resource.resourceId }),
            ),
          );
        }
        if (command === 'list') return wire(sessions.list(owner));
        if (command === 'close') return invoke(() => sessions.close(owner, p)).then(() => null);
        invoke(() => sessions[command](owner, p));
        return null;
      },
    };
  }
  return handlers;
}
function wire(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value));
}
function invoke<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(
      'conflict',
      error instanceof Error ? error.message : 'Terminal operation failed',
    );
  }
}
