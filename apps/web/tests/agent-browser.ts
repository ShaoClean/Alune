// Browser acceptance fixture only; never imported by the application entrypoint.
import { AgentClient } from '@alune/agent-client';
import type { RpcMessage } from '@alune/protocol';
import { installAgentRepositoryQueries } from '../src/api/agent-repositories';
import { createAgentCollaboration } from '../src/api/agent-collaboration';
import { aiApi } from '../src/api/ai';
import { repositoryApi, gitApi, accessTokenApi, pullRequestCenterApi } from '../src/api';

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
  const restores: Array<() => void> = [];
  if (fixture.collaboration) {
    const bindings = createAgentCollaboration(client, (id) => {
      if (id !== fixture.legacyId && id !== fixture.resource.resourceId)
        throw Error('Unknown fixture repository');
      return fixture.resource;
    });
    function install<T extends object>(api: T, subset: Partial<T>) {
      const before = { ...api };
      Object.assign(api, subset);
      restores.push(() => Object.assign(api, before));
    }
    install(aiApi, bindings.ai);
    install(accessTokenApi, bindings.accounts);
    install(pullRequestCenterApi, bindings.center);
    install(repositoryApi, bindings.repository);
  }
  return {
    legacyId: fixture.legacyId,
    resource: fixture.resource,
    close() {
      for (const fn of restores.reverse()) fn();
      restore();
      client.close();
    },
  };
}
