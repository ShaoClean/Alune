import type { AgentClient } from '@alune/agent-client';
import { isRecord, validId, isCommandOutput, isCommandExit, ProtocolError } from '@alune/protocol';

/** Retired UI categories mapped to sequenced Agent topics. Repository status
 * is invalidated and read again; it is never synthesized from progress. */
export const workspaceEventSuccessors = {
  'connection:status': 'hosts.changed',
  'repo:status': 'repositories.changed',
  'command:output': 'commands.output',
  'command:exit': 'commands.exit',
} as const;

/** UI callbacks retained while the transport is owned by the Agent client. */
export function subscribeWorkspaceEvents(
  client: AgentClient,
  events: Record<string, (...args: any[]) => void>,
) {
  const decoders = new Map<string, { stdout: TextDecoder; stderr: TextDecoder }>();
  const dispose = client.onEvent((event) => {
    if (
      event.type === workspaceEventSuccessors['command:output'] ||
      event.type === workspaceEventSuccessors['command:exit']
    ) {
      const p: unknown = event.payload;
      if (!event.resource || event.resource.agentId !== event.agentId) return;
      const identity = {
        agentId: event.agentId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        resource: event.resource,
        repositoryId: event.resource.resourceId,
        connectionId: event.agentId,
      };
      const key = isRecord(p)
        ? JSON.stringify([event.agentId, event.sessionId, event.resource.resourceId, p.commandId])
        : '';
      if (event.type === 'commands.output' && isCommandOutput(p) && events['command:output']) {
        let decoder = decoders.get(key);
        if (!decoder) {
          if (decoders.size >= 256)
            throw new ProtocolError('overloaded', 'Too many unfinished command streams', 'unknown');
          decoder = {
            stdout: new TextDecoder('utf-8', { ignoreBOM: true }),
            stderr: new TextDecoder('utf-8', { ignoreBOM: true }),
          };
          decoders.set(key, decoder);
        }
        const data = decoder[p.stream].decode(
          Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0)),
          { stream: true },
        );
        if (data) events['command:output']({ ...p, ...identity, data, type: p.stream });
      }
      if (event.type === 'commands.exit' && isCommandExit(p)) {
        const decoder = decoders.get(key);
        decoders.delete(key);
        for (const type of ['stdout', 'stderr'] as const) {
          const data = decoder?.[type].decode();
          if (data) events['command:output']?.({ ...p, ...identity, data, type });
        }
        // Interrupted/unknown exits remain available as Agent events. The
        // retired numeric callback must never receive a made-up exit code.
        if (p.exitCode !== null) events['command:exit']?.({ ...p, ...identity });
      }
    }
    if (event.type === 'events.resync-required' || event.type === 'accounts.hosts.changed')
      events.connect?.();
    if (event.type === workspaceEventSuccessors['connection:status']) {
      const p = event.payload;
      if (
        isRecord(p) &&
        validId(p.hostId) &&
        typeof p.status === 'string' &&
        ['connected', 'disconnected', 'connecting', 'error'].includes(p.status) &&
        typeof p.updatedAt === 'number' &&
        Number.isFinite(p.updatedAt) &&
        (p.error === undefined || typeof p.error === 'string')
      )
        events['connection:status']?.({ ...p, connectionId: p.hostId });
    }
    if (event.type === workspaceEventSuccessors['repo:status'])
      events['repository:changed']?.(event.resource?.resourceId);
    if (event.type === 'accounts.tokens.changed') events['access-tokens:changed']?.();
  });
  const close = client.onClose(() => {
    decoders.clear();
    events.disconnect?.();
  });
  events.connect?.();
  return () => {
    decoders.clear();
    dispose();
    close();
  };
}
