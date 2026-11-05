import { terminalsKernel } from './terminals';
import { repositoryWrites } from './repository-writes';
import {
  ProtocolError,
  REPOSITORY_CHUNK_BYTES,
  REPOSITORY_RESULT_MAX_BYTES,
  repositoryShape,
  repositoryString,
  validateEmpty,
  validateRepositoryQuery,
  validateResource,
  type JsonValue,
  type RepositoryReadReceipt,
} from '@alune/protocol';
import { randomUUID } from 'node:crypto';
import { GitLogChangedError, GitLogOptionsError } from '../modules/git/git-log';
import { GitSubmoduleReads } from '../modules/git/submodules';
import { GitWorktrees } from '../modules/git/worktrees';
import { RepositoryAnalyticsCache } from '../modules/repositories/analytics';
import { RepositoryCatalog } from '../modules/repositories/catalog';
import { RepositoryReader } from '../modules/repositories/reads';
import type { Handler, HandlerContext } from '../ports/handler';
import type { RepositoryTransport } from '../ports/repository-files';
import type { SqlDatabase } from '../ports/sql';
import { RepositoryReads } from '../runtime/reads';

type Snapshot = {
  buffer: Buffer;
  expires: number;
  sessionId: string;
  resourceId: string;
  generation: number;
};
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
export function repositoriesKernel(
  db: SqlDatabase,
  agentId: string,
  connection: (signal: AbortSignal, write?: boolean) => Promise<RepositoryTransport>,
) {
  const catalog = new RepositoryCatalog(db, agentId);
  const terminals = terminalsKernel(catalog);
  const reads = new RepositoryReads();
  const snapshots = new Map<string, Snapshot>();
  function prune() {
    for (const [id, s] of snapshots) if (s.expires < Date.now()) snapshots.delete(id);
  }
  function invalidate(resourceId: string) {
    analytics.invalidate(resourceId);
    const generation = reads.invalidate(resourceId);
    for (const [id, s] of snapshots) if (s.resourceId === resourceId) snapshots.delete(id);
    return generation;
  }
  async function withReader<T>(
    signal: AbortSignal,
    work: (reader: RepositoryReader) => Promise<T>,
  ): Promise<T> {
    const transport = await connection(signal);
    try {
      return await work(new RepositoryReader(transport));
    } finally {
      await transport.close?.();
    }
  }
  function handler(
    effect: Handler['effect'],
    validate: Handler['validate'],
    run: (p: any, c: HandlerContext) => Promise<unknown> | unknown,
    durable = true,
  ): Handler {
    return {
      effect,
      minimumProtocolMinor: 2,
      durable,
      validate,
      async run(p, c) {
        try {
          c.signal.throwIfAborted();
          return json(await run(p, c));
        } catch (error) {
          c.signal.throwIfAborted();
          if (error instanceof ProtocolError) throw error;
          if (error instanceof Error && error.name === 'TimeoutError')
            throw new ProtocolError('timeout', 'Repository read timed out');
          if (error instanceof GitLogChangedError)
            throw new ProtocolError('conflict', error.message);
          if (error instanceof GitLogOptionsError)
            throw new ProtocolError('invalid-params', error.message);
          const status = (error as { statusCode?: number }).statusCode;
          const code = (error as { code?: string }).code;
          throw new ProtocolError(
            status === 409
              ? 'conflict'
              : status === 404 || code === 'ENOENT'
                ? 'not-found'
                : status === 403 || code === 'EACCES' || code === 'EPERM'
                  ? 'permission-denied'
                  : status === 400
                    ? 'invalid-params'
                    : 'unavailable',
            error instanceof Error ? error.message : 'Repository read failed',
          );
        }
      },
    };
  }
  const resourceParam = (p: unknown) => {
    repositoryShape(p, ['resource']);
    validateResource(p.resource);
  };
  const pathParam = (p: unknown) => {
    repositoryShape(p, ['path']);
    if (!repositoryString(p.path))
      throw new ProtocolError('invalid-params', 'Invalid repository path');
  };
  const changed = (c: HandlerContext, resource: { agentId: string; resourceId: string }) => {
    const generation = invalidate(resource.resourceId);
    c.events.notifyState('repositories.changed', { generation }, resource);
    return { resource, generation };
  };
  const analytics = new RepositoryAnalyticsCache(async (resource, endDay, signal) => {
    const repo = catalog.get(resource);
    return withReader(signal, (r) =>
      r.query(repo, { resource, kind: 'analytics', params: { endDay } }),
    ) as Promise<import('@alune/domain').RepositoryAnalytics>;
  });
  const handlers: Record<string, Handler> = {
    ...terminals.handlers,
    ...repositoryWrites(catalog, connection, changed, terminals.registry),
    'repositories.analytics': handler(
      'query',
      (p) => {
        repositoryShape(p, ['resources', 'collect', 'refresh']);
        if (
          !Array.isArray(p.resources) ||
          p.resources.length > 20 ||
          typeof p.collect !== 'boolean' ||
          typeof p.refresh !== 'boolean'
        )
          throw new ProtocolError('invalid-params', 'Invalid analytics batch');
        p.resources.forEach(validateResource);
      },
      (p, c) => {
        // Reject foreign identities before touching cache keys or scheduling any read.
        for (const resource of p.resources) catalog.get(resource, false);
        return analytics.batch(
          [
            ...new Map<string, import('@alune/domain').ResourceRef>(
              p.resources.map((r: import('@alune/domain').ResourceRef) => [r.resourceId, r]),
            ).values(),
          ],
          p.collect,
          p.refresh,
          c.signal,
        );
      },
    ),
    'repositories.list': handler('query', validateEmpty, () => catalog.list()),
    'repositories.get': handler('query', resourceParam, (p) => catalog.get(p.resource, false)),
    'repositories.unregister': handler('mutation', resourceParam, (p, c) => {
      terminals.registry.assertRemovable({ repositoryId: catalog.get(p.resource, false).id });
      terminals.registry.remove({ repositoryId: p.resource.resourceId });
      const removed = catalog.unregister(p.resource);
      changed(c, removed.resource);
      return { resource: removed.resource, removed: true };
    }),
    'repositories.inspect': handler('query', pathParam, async (p, c) =>
      withReader(AbortSignal.any([c.signal, AbortSignal.timeout(120000)]), (r) =>
        r.inspect(p.path),
      ),
    ),
    'repositories.discover': handler(
      'query',
      (p) => {
        repositoryShape(p, ['path', 'depth']);
        if (
          !repositoryString(p.path) ||
          (p.depth !== undefined &&
            (!Number.isInteger(p.depth) || Number(p.depth) < 0 || Number(p.depth) > 8))
        )
          throw new ProtocolError('invalid-params', 'Invalid discovery request');
      },
      async (p, c) =>
        withReader(AbortSignal.any([c.signal, AbortSignal.timeout(120000)]), (r) =>
          r.discover(p.path, p.depth),
        ),
    ),
    'repositories.register': handler('mutation', pathParam, async (p, c) => {
      const inspected = await withReader(
        AbortSignal.any([c.signal, AbortSignal.timeout(120000)]),
        (r) => r.inspect(p.path),
      );
      c.signal.throwIfAborted();
      const repo = catalog.register(inspected.path, inspected.name, inspected.worktreeKind);
      changed(c, repo.resource);
      return repo;
    }),
    'repositories.pin': handler(
      'mutation',
      (p) => {
        repositoryShape(p, ['resource', 'pinned']);
        validateResource(p.resource);
        if (typeof p.pinned !== 'boolean')
          throw new ProtocolError('invalid-params', 'Invalid pinned state');
      },
      (p, c) => {
        const repo = catalog.pin(p.resource, p.pinned);
        changed(c, repo.resource);
        return repo;
      },
    ),
    'repositories.openRelated': handler(
      'mutation',
      (p) => {
        repositoryShape(p, ['resource', 'path', 'kind']);
        validateResource(p.resource);
        if (!repositoryString(p.path) || !['worktree', 'submodule'].includes(String(p.kind)))
          throw new ProtocolError('invalid-params', 'Invalid related repository');
      },
      async (p, c) => {
        const repo = catalog.get(p.resource);
        const inspected = await withReader(
          AbortSignal.any([c.signal, AbortSignal.timeout(120000)]),
          async (r) => {
            const path =
              p.kind === 'worktree'
                ? await new GitWorktrees(r.connection).resolve(repo.path, p.path)
                : await new GitSubmoduleReads(r.connection).resolve(repo.path, p.path);
            return r.inspect(path);
          },
        );
        c.signal.throwIfAborted();
        const registered = catalog.register(inspected.path, inspected.name, inspected.worktreeKind);
        changed(c, registered.resource);
        return registered;
      },
    ),
    // Explicit notification after a legacy write. It never executes/replays that write.
    'repositories.invalidate': handler(
      'mutation',
      resourceParam,
      (p, c) => {
        catalog.get(p.resource, false);
        return changed(c, p.resource);
      },
      false,
    ),
    'repositories.read': handler(
      'query',
      (p) => {
        validateRepositoryQuery(p);
      },
      async (p, c): Promise<RepositoryReadReceipt> => {
        const query = validateRepositoryQuery(p);
        const repo = catalog.get(query.resource);
        const generation = reads.generation(repo.id);
        const run = async (signal: AbortSignal) => {
          const result = await withReader(signal, (r) => r.query(repo, query));
          signal.throwIfAborted();
          return result;
        };
        const value =
          query.kind === 'status'
            ? await reads.status(repo.id, !!query.params.foreground, c.signal, run)
            : await run(AbortSignal.any([c.signal, AbortSignal.timeout(120000)]));
        c.signal.throwIfAborted();
        if (reads.generation(repo.id) !== generation)
          throw new ProtocolError('conflict', 'Repository changed during read');
        const buffer = Buffer.from(JSON.stringify(value));
        if (buffer.length > REPOSITORY_RESULT_MAX_BYTES)
          throw new ProtocolError(
            'overloaded',
            'Repository result exceeds the read budget; narrow the query',
          );
        const base = { resource: repo.resource, kind: query.kind, generation };
        if (buffer.length <= REPOSITORY_CHUNK_BYTES)
          return { ...base, value: JSON.parse(buffer.toString()) };
        prune();
        const used = [...snapshots.values()].reduce((sum, s) => sum + s.buffer.length, 0);
        if (snapshots.size >= 16 || used + buffer.length > 64 * 1024 * 1024)
          throw new ProtocolError('overloaded', 'Repository snapshot cache is full');
        const snapshotId = randomUUID();
        snapshots.set(snapshotId, {
          buffer,
          expires: Date.now() + 60000,
          sessionId: c.sessionId,
          resourceId: repo.id,
          generation,
        });
        return {
          ...base,
          snapshotId,
          bytes: buffer.length,
          chunks: Math.ceil(buffer.length / REPOSITORY_CHUNK_BYTES),
        };
      },
    ),
    'repositories.chunk': handler(
      'query',
      (p) => {
        repositoryShape(p, ['snapshotId', 'index']);
        if (!repositoryString(p.snapshotId) || !Number.isInteger(p.index) || Number(p.index) < 0)
          throw new ProtocolError('invalid-params', 'Invalid repository chunk');
      },
      (p, c) => {
        prune();
        const snapshot = snapshots.get(p.snapshotId);
        if (!snapshot || snapshot.sessionId !== c.sessionId)
          throw new ProtocolError('not-found', 'Repository snapshot expired; repeat the read');
        if (p.index >= Math.ceil(snapshot.buffer.length / REPOSITORY_CHUNK_BYTES))
          throw new ProtocolError('invalid-params', 'Chunk index out of range');
        return {
          snapshotId: p.snapshotId,
          index: p.index,
          base64: snapshot.buffer
            .subarray(p.index * REPOSITORY_CHUNK_BYTES, (p.index + 1) * REPOSITORY_CHUNK_BYTES)
            .toString('base64'),
        };
      },
    ),
    'repositories.release': handler(
      'query',
      (p) => {
        repositoryShape(p, ['snapshotId']);
        if (!repositoryString(p.snapshotId))
          throw new ProtocolError('invalid-params', 'Invalid snapshot');
      },
      (p, c) => {
        if (snapshots.get(p.snapshotId)?.sessionId === c.sessionId) snapshots.delete(p.snapshotId);
        return { released: true };
      },
    ),
  };
  return {
    handlers,
    async close() {
      await Promise.all([reads.close(), analytics.close(), terminals.close()]);
      snapshots.clear();
    },
  };
}
