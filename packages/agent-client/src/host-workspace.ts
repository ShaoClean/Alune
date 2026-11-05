import {
  ProtocolError,
  isRecord,
  validId,
  type OpenHostRoute,
  type ResourceRef,
  type PullRequestCenterQuery,
  type PullRequestCenterItem,
  type PullRequestSource,
} from '@alune/protocol';
import { AgentClient, type RequestOptions } from './client';
import { openRemoteAgent } from './host';

export class HostWorkspace {
  private owners = new Map<string, AgentClient>();
  constructor(readonly local: AgentClient) {
    if (!local.initialized)
      throw new ProtocolError('not-initialized', 'Initialize the local Agent first');
    this.owners.set(local.initialized.agentId, local);
  }
  async connect(policy: OpenHostRoute, options?: RequestOptions) {
    const client = await openRemoteAgent(this.local, policy, options);
    const id = client.initialized!.agentId;
    this.owners.set(id, client);
    client.onClose(() => {
      if (this.owners.get(id) === client) this.owners.delete(id);
    });
    return client;
  }
  owner(resource: ResourceRef) {
    const client = this.owners.get(resource.agentId);
    if (client?.state !== 'ready')
      throw new ProtocolError('disconnected', 'Resource owner is offline');
    return client;
  }
  async catalog(options: RequestOptions = {}) {
    await Promise.allSettled(
      [...this.owners.values()]
        .filter((c) => c !== this.local)
        .map((c) => c.listRepositories(options)),
    );
    options.signal?.throwIfAborted();
    return this.local.request('hosts.catalog', {}, options);
  }
  /** Pull one bounded wave at a time. Cursors and responses stay attached to the
   * original connection; reconnect starts a new scan, never resumes an old cursor. */
  async *reviews(query: PullRequestCenterQuery, options: RequestOptions = {}) {
    const sessions = [...this.owners].map(([agentId, client]) => ({
      agentId,
      client,
      discovered: false,
      discoveryId: '',
      cursor: '',
      done: false,
    }));
    const sources = new Map<string, PullRequestSource>(),
      items = new Map<string, PullRequestCenterItem>(),
      offline = new Set<string>();
    const saved = await this.local.request('hosts.catalog', {}, options);
    if (!isRecord(saved) || !Array.isArray(saved.hosts))
      throw new ProtocolError('invalid-request', 'Invalid host catalog');
    for (const host of saved.hosts)
      if (isRecord(host) && validId(host.agentId) && !this.owners.has(host.agentId))
        offline.add(host.agentId);
    while (sessions.some((s) => !s.done)) {
      await Promise.all(
        sessions
          .filter((s) => !s.done)
          .map(async (s) => {
            try {
              const page = s.discovered
                ? await s.client.collaboration(
                    'catalog.reviews.list',
                    {
                      input: s.cursor
                        ? { cursor: s.cursor }
                        : { query, discoveryId: s.discoveryId },
                    },
                    options,
                  )
                : await s.client.collaboration(
                    'catalog.reviews.sources',
                    { input: s.cursor ? { cursor: s.cursor } : {} },
                    options,
                  );
              if (page.sources.some((source) => source.resource?.agentId !== s.agentId))
                throw new ProtocolError('conflict', 'Review source belongs to another Agent');
              for (const source of page.sources)
                sources.set(JSON.stringify([s.agentId, source.id]), source);
              if ('items' in page) {
                for (const item of page.items) {
                  const key = JSON.stringify([item.projectKey, item.number]),
                    old = items.get(key);
                  const latest = old && old.updatedAt >= item.updatedAt ? old : item;
                  items.set(key, {
                    ...latest,
                    sourceIds: [...new Set([...(old?.sourceIds ?? []), ...item.sourceIds])],
                  });
                }
                s.cursor = page.nextCursor ?? '';
                s.done = !s.cursor;
              } else {
                s.discoveryId = page.discoveryId;
                s.cursor = page.cursor ?? '';
                s.discovered = page.complete;
              }
            } catch (error) {
              options.signal?.throwIfAborted();
              if (error instanceof ProtocolError && error.kind === 'cancelled') throw error;
              s.done = true;
              offline.add(s.agentId);
              for (const [key, source] of sources)
                if (source.resource?.agentId === s.agentId)
                  sources.set(key, { ...source, availability: 'stale' });
            }
          }),
      );
      options.signal?.throwIfAborted();
      yield {
        items: [...items.values()].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key),
        ),
        sources: [...sources.values()],
        unavailableAgentIds: [...offline],
        complete: sessions.every((s) => s.done),
      };
    }
  }
}
