import { sshTerminalEnvironment, type ConnectionProgress } from '@alune/domain';
import type { HostRepositoryReads } from '../ports/host-repository-reads';
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
  actualVersion?: string;
  source?: string;
  repositories: RepositoryResource[];
}
type Connection = {
  session: string;
  controller: AbortController;
  routeId: string;
  hostId: string;
  terminalEnvironment: string;
  relay?: HostRelay;
  phase: string;
  gitAvailable: boolean;
  mode?: string;
  daemonPid?: number;
  fallbackReason?: string;
  gitProxy?: string;
  appliedProxy?: import('../adapters/network/proxy-transport').ProxySnapshot;
  fresh: boolean;
  failure?: ProtocolError;
  reason?: string;
  updatedAt?: number;
  notify?: () => void;
  sshConnected?: boolean;
  failurePhase?: string;
  progress?: ConnectionProgress;
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
        typeof s.hostKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(s.hostKey) ||
        !validId(s.agentId) ||
        !Array.isArray(s.repositories) ||
        s.repositories.some(
          (r: unknown) => validateRepositoryResource(r).resource.agentId !== s.agentId,
        ),
    )
  )
    throw new ProtocolError('state-corrupt', 'Invalid saved remote catalog');
  // Deleted profiles are no longer owners. Older candidates retained their
  // catalog cache, which must not prevent explicitly trusting a new profile.
  const profiles = new Set(settings.hosts.list().hosts.map((profile) => profile.id));
  const saved = new Map<string, Saved>(
    records.filter((s) => profiles.has(s.hostId)).map((s) => [s.hostId, s]),
  );
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
  let lastChange = Date.now();
  function notify(r: Connection) {
    r.updatedAt = lastChange = Math.max(Date.now(), lastChange + 1);
    r.notify?.();
  }
  function remoteTerminals(sessionScopedOnly = false) {
    return [...live.values()].flatMap((r) =>
      r.phase === 'ready' && r.relay && (!sessionScopedOnly || r.mode !== 'daemon')
        ? r.relay.terminalImpact.map((t) => {
            const repo = saved
              .get(r.hostId)
              ?.repositories.find((repo) => repo.id === t.repositoryId);
            return {
              id: r.routeId + ':' + t.requestId,
              requestId: t.requestId,
              repositoryId: t.repositoryId,
              repositoryName: repo?.name ?? t.repositoryId,
              initialPath: repo?.path ?? '',
              source: 'ssh',
              connectionId: r.hostId,
              environment: r.terminalEnvironment,
              state: 'running',
              createdAt: r.updatedAt ?? 0,
            };
          })
        : [],
    );
  }
  function stop(r: Connection) {
    r.controller.abort();
    r.relay?.close();
    r.phase = 'offline';
    r.sshConnected = false;
    r.fresh = false;
    r.progress = undefined;
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
        targetVersion: require('../version.json').version,
        actualVersion: s?.actualVersion ?? null,
        source: s?.source ?? null,
        terminalEnvironment: r?.terminalEnvironment ?? sshTerminalEnvironment(p),
        agentId: s?.agentId ?? null,
        hostKey: s?.hostKey ?? null,
        state: r?.phase ?? 'offline',
        reason: r?.reason ?? null,
        progress:
          r && r.phase !== 'ready' && r.phase !== 'offline' ? (r.progress ?? null) : null,
        sshConnected: r?.sshConnected ?? false,
        failurePhase: r?.failurePhase ?? null,
        proxyRevision: r?.appliedProxy?.revision ?? null,
        gitAvailable: r?.phase === 'ready' ? r.gitAvailable : null,
        updatedAt: r?.updatedAt ?? 0,
        activeTasks:
          r?.phase === 'ready'
            ? (r.relay?.activeTasks ?? 0) + (r.relay?.terminalImpact.length ?? 0)
            : 0,
        mode: r?.phase === 'ready' ? r.mode : null,
        daemonPid: r?.phase === 'ready' ? r.daemonPid ?? null : null,
        fallbackReason: r?.phase === 'ready' ? r.fallbackReason ?? null : null,
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
  const reads: HostRepositoryReads = {
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
        if (prior && p.hostKey !== null && prior.hostKey !== p.hostKey)
          throw new ProtocolError('permission-denied', 'Pinned SSH host key changed');
        if (p.reconnectRevision) settings.proxy.assertRevision(p.reconnectRevision);
        if (prev && prev.phase !== 'offline') {
          if (
            !p.reconnectRevision ||
            prev.session !== c.sessionId ||
            prev.phase !== 'ready' ||
            prev.relay?.activeTasks ||
            prev.relay?.terminalImpact.length
          )
            throw new ProtocolError('busy', '服务器仍有运行中任务、终端或正在连接，请结束后重试。');
          stop(prev);
        }
        if ([...live.values()].filter((r) => r.phase !== 'offline').length >= 16)
          throw new ProtocolError('overloaded', 'Too many SSH hosts');
        const r: Connection = {
          session: c.sessionId,
          controller: new AbortController(),
          routeId: randomUUID(),
          hostId: p.hostId,
          terminalEnvironment: sshTerminalEnvironment(profile),
          phase: 'connecting',
          gitAvailable: false,
          fresh: false,
        };
        r.notify = () =>
          c.events.notifyState('hosts.changed', {
            hostId: p.hostId,
            updatedAt: r.updatedAt ?? 0,
            status:
              r.phase === 'ready'
                ? 'connected'
                : r.phase === 'offline'
                  ? r.reason
                    ? 'error'
                    : 'disconnected'
                  : 'connecting',
            ...(r.reason ? { error: r.reason } : {}),
            ...(r.phase !== 'ready' && r.phase !== 'offline' && r.progress
              ? { progress: r.progress as unknown as JsonValue }
              : {}),
          });
        live.set(p.hostId, r);
        notify(r);
        const signal = AbortSignal.any([
          r.controller.signal,
          c.signal,
          c.sessionSignal,
        ]);
        try {
          if (profile.hasPassword || profile.hasPassphrase || settings.proxy.read().authEnabled)
            await settings.readyCredentials(signal);
          const { connectHost } = await import('../adapters/ssh/connect');
          if (p.reconnectRevision) settings.proxy.assertRevision(p.reconnectRevision);
          signal.throwIfAborted();
          r.appliedProxy =
            (!p.reconnectRevision && prev?.session === c.sessionId
              ? prev.appliedProxy
              : undefined) ?? settings.proxy.snapshot();
          const conn = await connectHost(
            directory,
            settings.hosts.credential(p.hostId),
            { ...p, hostKey: prior?.hostKey ?? p.hostKey },
            r.appliedProxy,
            signal,
            (phase) => {
              r.phase = phase;
              r.sshConnected = true;
              r.progress = { phase };
              notify(r);
            },
          );
          try {
            signal.throwIfAborted();
          } catch (e) {
            conn.close();
            throw e;
          }
          r.phase = 'negotiating';
          r.progress = { phase: r.phase };
          notify(r);
          r.gitAvailable = conn.gitAvailable;
          r.mode = conn.mode;
          r.daemonPid = conn.daemonPid;
          r.fallbackReason = conn.fallbackReason;
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
                hostKey: conn.hostKey,
                agentId: id.agentId,
                digest: conn.digest,
                target: conn.target,
                actualVersion: id.implementation.version,
                source: conn.source,
                repositories: prior?.repositories ?? [],
              });
              clearTimeout(timer);
              r.phase = 'ready';
              r.progress = undefined;
              notify(r);
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
              r.progress = undefined;
              r.fresh = false;
              notify(r);
              conn.close();
            },
            () => {
              r.fresh = false;
            },
          );
          return { routeId: r.routeId, target: conn.target, source: conn.source, hostKey: conn.hostKey, gitAvailable: conn.gitAvailable };
        } catch (e) {
          r.failurePhase = r.phase;
          stop(r);
          r.reason = e instanceof ProtocolError ? e.message : 'SSH connection failed';
          notify(r);
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
    remoteTerminals,
    activeWrites: () =>
      [...live.values()].flatMap((r) =>
        r.phase === 'ready' && r.relay
          ? r.relay.pendingWrites.map((w) => ({ ...w, hostId: r.hostId }))
          : [],
      ),
    closeShellRoutes() {
      for (const r of live.values())
        if (r.phase === 'ready' && r.mode !== 'daemon' && r.relay?.terminalImpact.length) stop(r);
    },
    close() {
      for (const r of live.values()) stop(r);
      live.clear();
    },
    async probeAuthentication(id: string, provided: unknown, signal: AbortSignal) {
      const pin = saved.get(id)?.hostKey;
      const key = provided ?? pin;
      if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key) || (pin && pin !== key))
        throw new ProtocolError('permission-denied', '请核对 SSH 主机公钥指纹。');
      await settings.readyCredentials(signal);
      const { probeAuthentication } = await import('../adapters/ssh/connect');
      await probeAuthentication(
        settings.hosts.credential(id),
        key,
        settings.proxy.snapshot(),
        signal,
      );
    },
    async testProxy(
      id: string,
      resource: import('@alune/protocol').ResourceRef | undefined,
      sessionId: string,
      signal: AbortSignal,
    ) {
      const r = live.get(id);
      if (
        !r?.relay ||
        r.phase !== 'ready' ||
        r.session !== sessionId ||
        !r.sshConnected ||
        r.appliedProxy?.revision !== settings.proxy.read().revision ||
        r.gitProxy === 'disabled'
      )
        throw new ProtocolError('unavailable', '请先使用当前代理重新连接服务器。');
      if (resource) {
        if (r.gitProxy !== 'ready')
          throw new ProtocolError('unavailable', 'SSH 主机没有允许 Git 回环转发。');
        await r.relay.snapshot({ kind: 'proxyGitTest', resource }, signal);
      }
    },
    disconnect(sessionId: string) {
      for (const r of live.values())
        if (r.session === sessionId) {
          r.appliedProxy = undefined;
          stop(r);
        }
    },
    proxyChanged() {
      // Established tunnels and outstanding writes keep the snapshot they opened
      // with. Only an explicit reconnect applies a newly saved policy.
      for (const r of live.values())
        if (r.phase !== 'ready' && r.phase !== 'offline') {
          r.appliedProxy = undefined;
          stop(r);
        }
    },
    invalidate(hostId?: string) {
      for (const r of live.values())
        if (!hostId || r.hostId === hostId) {
          r.appliedProxy = undefined;
          stop(r);
        }
    },
    forget(hostId: string) {
      const route = live.get(hostId);
      if (route) stop(route);
      live.delete(hostId);
      if (saved.delete(hostId)) document.write([...saved.values()]);
    },
  };
}
