import { randomUUID } from 'node:crypto';
import type { JsonValue } from '@alune/protocol';
import type { ResourceRef } from '@alune/domain';
import type { CommandOptions } from '../ports/process';
import type { HandlerContext } from '../ports/handler';

/** Observe authorized repository writes on their owning Agent/session only. */
export function commandObserver(
  c: HandlerContext,
  resource: ResourceRef,
  operationId: string,
): CommandOptions['observe'] {
  if (!c.events.subscribed('commands.output') && !c.events.subscribed('commands.exit'))
    return undefined;
  return ({ executable, args, cwd }) => {
    const identity = {
      commandId: randomUUID(),
      operationId,
      executable,
      args: [...args],
      cwd,
      command: [executable, ...args]
        .map((v) => (/^[\w./:-]+$/.test(v) ? v : JSON.stringify(v)))
        .join(' '),
    };
    return {
      async output(stream, bytes) {
        if (!c.events.subscribed('commands.output')) return;
        // Leave room for JSON envelope and command metadata. EventQueue also
        // enforces its own byte budget; overflow fails explicitly, never drops.
        for (let start = 0; start < bytes.length; start += 16384)
          await c.events.write(
            'commands.output',
            {
              ...identity,
              stream,
              base64: bytes.subarray(start, start + 16384).toString('base64'),
            } as unknown as JsonValue,
            resource,
            c.signal,
          );
      },
      async exit(exitCode, signal) {
        if (c.events.subscribed('commands.exit'))
          await c.events.write(
            'commands.exit',
            {
              ...identity,
              exitCode,
              signal,
            } as unknown as JsonValue,
            resource,
            c.sessionSignal,
          );
      },
    };
  };
}
