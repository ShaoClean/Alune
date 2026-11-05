import type { LegacyRepositoryReads } from '../ports/legacy-repository-reads';
import type { SnapshotRequest } from '../modules/hosts/snapshot';
import { randomUUID } from 'node:crypto';
import {
  ProtocolError,
  validateOpenHost,
  validateResource,
  validateEmpty,
  validId,
  isRecord,
  parseMessage,
  validateRepositoryResource,
  type JsonValue,
  type RepositoryResource,
  type OpenHostRoute,
} from '@alune/protocol';
import { HostRelay } from '../modules/hosts/relay';
import { connectHost } from '../adapters/ssh/connect';
import type { JsonDocument } from '../ports/state';
import type { Handler } from '../ports/handler';
import type { settingsKernel } from './settings-kernel';
import type { RepositoryCatalog } from '../modules/repositories/catalog';

interface Saved {
  hostId: string;
  hostKey: string;
  agentId: string;
  digest: string;
  target: string;
  repositories: RepositoryResource[];
}
type Connection = {
  session: string;
  controller: AbortController;
  routeId: string;
  hostId: string;
  relay?: HostRelay;
  phase: string;
  gitAvailable: boolean;
  gitProxy?: string;
  fresh: boolean;
  failure?: ProtocolError;
  reason?: string;
  sshConnected?: boolean;
  failurePhase?: string;
};
export function hostsKernel(
  directory: string,
  local: RepositoryCatalog,
  settings: ReturnType<typeof settingsKernel>,
  document: JsonDocument,
) {
  const records = document.read() ?? [];
  if (
    !Array.isArray(records) ||
    records.some(
      (s) =>
        !s ||
        !validId(s.hostId) ||
        !validId(s.agentId) ||
        !Array.isArray(s.repositories) ||
        s.repositories.some(
          (r: unknown) => validateRepositoryResource(r).resource.agentId !== s.agentId,
        ),
    )
  )
    throw new ProtocolError('state-corrupt', 'Invalid saved remote catalog');
  const saved = new Map<string, Saved>(records.map((s) => [s.hostId, s]));
  const live = new Map<string, Connection>();
  function save(record: Saved) {
    const next = new Map(saved);
    next.set(record.hostId, record);
    document.write([...next.values()]);
    saved.set(record.hostId, record);
  }
  function method(
    validate: Handler['validate'],
    run: (p: any, c: Parameters<Handler['run']>[1]) => unknown,
    effect: Handler['effect'] = 'query',
  ): Handler {
    return {
      minimumProtocolMinor: 6,
      validate,
      effect,
      durable: false,
      run: async (p, c) => (await run(p, c)) as JsonValue,
    };
  }
  const routeParam = (p: unknown) => {
    if (!isRecord(p) || !validId(p.routeId))
      throw new ProtocolError('invalid-params', 'Expected a route ID');
  };
  const lookup = (routeId: string, session: string) => {
    const r = [...live.values()].find((v) => v.routeId === routeId && v.session === session);
    if (!r?.relay || r.phase === 'offline')
      throw (
        r?.failure ??
        new ProtocolError('disconnected', r?.reason ?? 'SSH route is closed', 'unknown')
      );
    return r;
  };
  function stop(r: Connection) {
    r.controller.abort();
    r.relay?.close();
    r.phase = 'offline';
    r.sshConnected = false;
    r.fresh = false;
  }
  function catalog() {
    const profiles = settings.hosts.list().hosts;
    const localList = local.list();
    const aliases = localList
      .filter((r) => r.source === 'ssh')
      .map((r) => ({ id: r.id, binding: local.hostBinding(r.id) }));
    const hosts = profiles.map((p) => {
      const s = saved.get(p.id),
        r = live.get(p.id);
      return {
        hostId: p.id,
        agentId: s?.agentId ?? null,
        state: r?.phase ?? 'offline',
        reason: r?.reason ?? null,
        sshConnected: r?.sshConnected ?? false,
        failurePhase: r?.failurePhase ?? null,
        gitAvailable: r?.phase === 'ready' ? r.gitAvailable : null,
        gitProxy: r?.phase === 'ready' ? r.gitProxy : null,
        stale: !r?.fresh,
        repositories: s?.repositories ?? [],
        bindings: aliases
          .filter((a) => a.binding?.hostId === p.id)
          .map((a) => ({ localId: a.id, resource: a.binding!.resource })),
      };
    });
    // An imported legacy registration remains addressable by its original id;
    // suppress its duplicate presentation only when that host owns the same path.
    const localRows = localList.filter(
      (repo) =>
        repo.source === 'local' ||
        !hosts.some((h) => {
          if (h.hostId !== repo.connectionId) return false;
          const key = (path: string) =>
            saved.get(h.hostId)?.target === 'win32-x64'
              ? path.replaceAll('\\', '/').toLowerCase()
              : path;
          return h.repositories.some((r) => key(r.path) === key(repo.path));
        }),
    );
    return { local: localRows, hosts };
  }
  function pinned(repo: RepositoryResource) {
    const binding = local.hostBinding(repo.id);
    const host = binding && live.get(binding.hostId);
    if (
      !binding ||
      !host?.relay ||
      host.phase !== 'ready' ||
      repo.connectionId !== host.hostId ||
      saved.get(host.hostId)?.agentId !== binding.resource.agentId
    )
      throw new ProtocolError(
        'unavailable',
        'Connect and bind the SSH repository before using local credentials',
      );
    const relay = host.relay;
    return (kind: SnapshotRequest['kind'], signal: AbortSignal, argument?: string) =>
      relay.snapshot(
        { resource: binding.resource, kind, ...(argument !== undefined ? { argument } : {}) },
        signal,
      );
  }
  const reads: LegacyRepositoryReads = {
    async remotes(repo, signal) {
      const result = await pinned(repo)('remotes', signal);
      if (
        !Array.isArray(result) ||
        !result.every(
          (r) =>
            isRecord(r) && ['name', 'fetchUrl', 'pushUrl'].every((k) => typeof r[k] === 'string'),
        )
      )
        throw new ProtocolError('invalid-request', 'Invalid remote Git remotes');
      return result as unknown as import('@alune/domain').RemoteInfo[];
    },
    async branch(repo, name, signal) {
      const r = await pinned(repo)('branch', signal, name);
      if (
        !isRecord(r) ||
        typeof r.name !== 'string' ||
        typeof r.sha !== 'string' ||
        !/^[a-f0-9]{40,64}$/.test(r.sha)
      )
        throw new ProtocolError('invalid-request', 'Invalid remote Git branch');
      return { name: r.name, sha: r.sha };
    },
    async openStaged(repo) {
      const read = pinned(repo);
      return {
        release() {},
        staged: {
          async read(signal) {
            const r = await read('staged', signal);
            if (
              !isRecord(r) ||
              typeof r.revision !== 'string' ||
              !/^[a-f0-9]{64}$/.test(r.revision) ||
              typeof r.diff !== 'string' ||
              Buffer.byteLength(r.diff) > 98304
            )
              throw new ProtocolError('invalid-request', 'Invalid staged snapshot');
            return { revision: r.revision, diff: r.diff };
          },
          async assertRevision(revision, signal) {
            await read('checkStaged', signal, revision);
          },
        },
      };
    },
  };
  const handlers: Record<string, Handler> = {
    'hosts.catalog': method(validateEmpty, catalog),
    'hosts.bindRepository': method(
      (p) => {
        if (!isRecord(p)) throw new ProtocolError('invalid-params', 'Expected remote resource');
        validateResource(p.resource);
      },
      (p, c) => {
        const host = [...saved.values()].find((s) => s.agentId === p.resource.agentId);
        const liveHost = host && live.get(host.hostId);
        const repo = host?.repositories.find((r) => r.id === p.resource.resourceId);
        if (
          !host ||
          !repo ||
          !liveHost?.fresh ||
          liveHost.session !== c.sessionId ||
          liveHost.phase !== 'ready'
        )
          throw new ProtocolError('unavailable', 'Refresh the selected SSH catalog before binding');
        return local.bindHost(host.hostId, repo, host.target === 'win32-x64');
      },
      'mutation',
    ),
    'hosts.open': method(
      validateOpenHost,
      async (p: OpenHostRoute, c) => {
        const profile = settings.hosts.list().hosts.find((h) => h.id === p.hostId);
        if (!profile) throw new ProtocolError('not-found', 'Unknown host profile');
        const prev = live.get(p.hostId),
          prior = saved.get(p.hostId);
        if (prev && prev.phase !== 'offline')
          throw new ProtocolError('busy', 'Host already has an active route');
        if (prior && prior.hostKey !== p.hostKey)
          throw new ProtocolError('permission-denied', 'Pinned SSH host key changed');
        if ([...live.values()].filter((r) => r.phase !== 'offline').length >= 16)
          throw new ProtocolError('overloaded', 'Too many SSH hosts');
        const r: Connection = {
          session: c.sessionId,
          controller: new AbortController(),
          routeId: randomUUID(),
          hostId: p.hostId,
          phase: 'connecting',
          gitAvailable: false,
          fresh: false,
        };
        live.set(p.hostId, r);
        const signal = AbortSignal.any([
          r.controller.signal,
          c.signal,
          c.sessionSignal,
          AbortSignal.timeout(180000),
        ]);
        try {
          if (profile.hasPassword || profile.hasPassphrase || settings.proxy.read().authEnabled)
            await settings.readyCredentials(signal);
          const conn = await connectHost(
            directory,
            settings.hosts.credential(p.hostId),
            p,
            settings.proxy.snapshot(),
            signal,
            prior?.digest,
            (phase) => {
              r.phase = phase;
              r.sshConnected = true;
            },
          );
          try {
            signal.throwIfAborted();
          } catch (e) {
            conn.close();
            throw e;
          }
          r.phase = 'negotiating';
          r.gitAvailable = conn.gitAvailable;
          r.gitProxy = conn.gitProxy;
          const timer = setTimeout(() => stop(r), 30000);
          timer.unref();
          r.relay = new HostRelay(
            conn.transport,
            conn.version,
            (id) => {
              if (
                id.agentId === local.agentId ||
                (prior && prior.agentId !== id.agentId) ||
                [...saved.values()].some((s) => s.hostId !== p.hostId && s.agentId === id.agentId)
              )
                throw new ProtocolError(
                  'conflict',
                  'Remote Agent identity changed or is bound to another host',
                );
              save({
                hostId: p.hostId,
                hostKey: p.hostKey,
                agentId: id.agentId,
                digest: conn.digest,
                target: conn.target,
                repositories: prior?.repositories ?? [],
              });
              clearTimeout(timer);
              r.phase = 'ready';
            },
            (rows) => {
              const s = saved.get(p.hostId)!;
              save({ ...s, repositories: rows });
              r.fresh = true;
            },
            (error) => {
              if (error instanceof ProtocolError) r.failure = error;
              r.failurePhase = r.phase;
              r.reason = error instanceof ProtocolError ? error.message : 'SSH channel closed';
              r.sshConnected = false;
              clearTimeout(timer);
              r.phase = 'offline';
              r.fresh = false;
              conn.close();
            },
            () => {
              r.fresh = false;
            },
          );
          return { routeId: r.routeId, target: conn.target, gitAvailable: conn.gitAvailable };
        } catch (e) {
          r.failurePhase = r.phase;
          stop(r);
          r.reason = e instanceof ProtocolError ? e.message : 'SSH connection failed';
          throw e;
        }
      },
      'mutation',
    ),
    'hosts.send': method(
      (p) => {
        routeParam(p);
        if (!isRecord(p) || !isRecord(p.message))
          throw new ProtocolError('invalid-params', 'Expected a request');
      },
      async (p, c) => {
        const m = parseMessage(JSON.stringify(p.message));
        if (!('method' in m)) throw new ProtocolError('invalid-request', 'Expected a client frame');
        await lookup(p.routeId, c.sessionId).relay!.send(m);
        return null;
      },
      'mutation',
    ),
    'hosts.receive': method(routeParam, (p, c) =>
      lookup(p.routeId, c.sessionId).relay!.poll(c.signal),
    ),
    'hosts.disconnect': method(
      routeParam,
      (p, c) => {
        stop(lookup(p.routeId, c.sessionId));
        return null;
      },
      'mutation',
    ),
    'hosts.legacyPath': method(
      (p) => {
        if (!isRecord(p) || !validId(p.resourceId) || !validId(p.hostId))
          throw new ProtocolError('invalid-params', 'Invalid legacy reference');
      },
      (p) => {
        const r = local.get({ agentId: local.agentId, resourceId: p.resourceId }, false);
        if (r.source !== 'ssh' || r.connectionId !== p.hostId)
          throw new ProtocolError('not-found', 'Legacy repository belongs to another host');
        return { path: r.path, agentId: saved.get(p.hostId)?.agentId ?? null };
      },
    ),
  };
  return {
    handlers,
    reads,
    close() {
      for (const r of live.values()) stop(r);
      live.clear();
    },
    invalidate(hostId?: string) {
      for (const r of live.values()) if (!hostId || r.hostId === hostId) stop(r);
    },
  };
}
