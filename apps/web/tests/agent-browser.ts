// Browser acceptance fixture only; never imported by the application entrypoint.
import { AgentClient } from '@alune/agent-client';
import type { RpcMessage } from '@alune/protocol';
import { installAgentRepositoryQueries } from '../src/api/agent-repositories';
import { repositoryApi, gitApi } from '../src/api';

export async function connectFixture() {
  const fixture = await fetch('/p3-fixture.json').then((r) => r.json());
  const socket = new WebSocket(fixture.socket);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('Fixture connection failed'));
  });
  const messages = new Set<(value: RpcMessage) => void>(),
    closed = new Set<(error: Error) => void>();
  socket.onmessage = (event) => {
    const value = JSON.parse(event.data);
    for (const fn of messages) fn(value);
  };
  socket.onclose = () => {
    for (const fn of closed) fn(new Error('Fixture disconnected'));
  };
  const client = new AgentClient({
    async send(message) {
      socket.send(JSON.stringify(message));
    },
    onMessage(fn) {
      messages.add(fn);
      return () => messages.delete(fn);
    },
    onClose(fn) {
      closed.add(fn);
      return () => closed.delete(fn);
    },
    close() {
      socket.close();
    },
  });
  await client.initialize();
  await client.subscribe(['repositories.changed']);
  const restore = installAgentRepositoryQueries(
    client,
    (id) => (id === fixture.legacyId ? fixture.resource : undefined),
    repositoryApi,
    gitApi,
  );
  return {
    legacyId: fixture.legacyId,
    resource: fixture.resource,
    close() {
      restore();
      client.close();
    },
  };
}
