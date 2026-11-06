import {
  isRepositoryWriteKind,
  ProtocolError,
  validateRepositoryResource,
  type RepositoryWriteArgs,
  type RepositoryWriteKind,
} from '@alune/protocol';
import type { AgentClient } from '@alune/agent-client';
import type { RepositoryQueryKind, RepositoryQueryMap, ResourceRef } from '@alune/protocol';
import type { repositoryApi, gitApi } from './index';

type RepositoryApi = typeof repositoryApi;
type GitApi = typeof gitApi;
type Invocation = {
  kind: RepositoryQueryKind;
  params: object;
  signal?: AbortSignal;
  select?: (value: any) => any;
};
type Query = (...args: any[]) => Invocation;
const empty =
  (kind: RepositoryQueryKind): Query =>
  (_id, signal) => ({ kind, params: {}, signal });
// These are live views, not caller-pinned file/diff snapshots. A result
// cancelled by an observed change can be re-read before it reaches the view.
const liveQueries = new Set<RepositoryQueryKind>([
  'status',
  'context',
  'log',
  'signatures',
  'branches',
  'stashes',
  'remotes',
  'worktrees',
  'submodules',
  'lfs',
  'signing',
  'tags',
]);
const repositoryQueries: Partial<Record<keyof RepositoryApi, Query>> = {
  status: (_id, signal, foreground = false) => ({ kind: 'status', params: { foreground }, signal }),
  context: empty('context'),
  worktrees: empty('worktrees'),
  submodules: empty('submodules'),
  lfs: empty('lfs'),
  branches: empty('branches'),
  stashes: empty('stashes'),
  remotes: empty('remotes'),
  log: (_id, params = {}, signal) => ({ kind: 'log', params, signal }),
  diff: (_id, params = {}, signal) =>
    params.editable
      ? {
          kind: 'editableDiff',
          params: { file: params.file, staged: !!params.staged, fullFile: !!params.fullFile },
          signal,
        }
      : { kind: 'diff', params, signal },
  diffImage: (_id, params, signal) => ({ kind: 'diffImage', params, signal }),
  commitFiles: (_id, commit, parentCommit) => ({
    kind: 'commitFiles',
    params: { commit, parentCommit },
  }),
  tree: (_id, path, signal) => ({ kind: 'tree', params: { path }, signal }),
  file: (_id, path, signal) => ({ kind: 'file', params: { path }, signal }),
  blame: (_id, params, signal) => ({ kind: 'blame', params, signal }),
  blameCommit: (_id, hash, signal) => ({ kind: 'blameCommit', params: { hash }, signal }),
};
const gitQueries: Partial<Record<keyof GitApi, Query>> = {
  signingConfig: empty('signing'),
  signatures: (_id, hashes, signal) => ({ kind: 'signatures', params: { hashes }, signal }),
  tags: (_id) => ({ kind: 'tags', params: {}, select: (value) => value.local }),
  remoteTags: (_id, remote) => ({
    kind: 'tags',
    params: { remote },
    select: (value) => value.remote,
  }),
  stashShow: (_id, index) => ({
    kind: 'stashDiff',
    params: { index },
    select: (diff) => ({ diff }),
  }),
};
const previews: Partial<Record<keyof GitApi, Query>> = {
  previewRebase: (_id, base) => ({ kind: 'previewRebase', params: { base } }),
  rebaseState: empty('rebaseState'),
  rebaseConflict: (_id, path) => ({ kind: 'rebaseConflict', params: { path } }),
  previewWorkspaceFile: (_id, path) => ({ kind: 'previewWorkspaceFile', params: { path } }),
  previewNewFileDeletion: (_id, path) => ({ kind: 'previewNewFileDeletion', params: { path } }),
  previewDiscardChanges: empty('previewDiscardChanges'),
};
const legacyRepositoryWrites = new Set([
  'pin',
  'delete',
  'openWorktree',
  'openSubmodule',
  'applyAccessToken',
  'mutatePullRequest',
]);

/** Explicit P3 seam for isolated repositories. No global/default executor switch.
 * The resolver maps a legacy UI ID to the registered Agent resource on that host.
 */
export function createAgentRepositoryQueries(
  client: AgentClient,
  resourceFor: (id: string) => ResourceRef | undefined,
  legacyRepository: RepositoryApi,
  legacyGit: GitApi,
  executor: 'agent' | 'legacy' = 'agent',
) {
  let disposed = false;
  const lifetime = new AbortController();
  const superseded = Symbol('locally invalidated repository read');
  const related = new Map<string, ResourceRef>();
  const resolve = (id: string) => related.get(id) ?? resourceFor(id);
  const observed = new Map<string, string>();
  const remember = (value: unknown, parent: ResourceRef) => {
    const repo = validateRepositoryResource(value);
    if (repo.resource.agentId !== parent.agentId) throw new Error('Agent 仓库身份不匹配。');
    related.set(repo.id, repo.resource);
    return repo;
  };
  const versions = new Map<string, number>();
  const dirty = new Set<string>();
  const pending = new Map<string, Set<AbortController>>();
  const key = (resource: ResourceRef) => `${resource.agentId}:${resource.resourceId}`;
  const bump = (id: string) => {
    versions.set(id, (versions.get(id) ?? 0) + 1);
    for (const controller of pending.get(id) ?? [])
      controller.abort(new Error('仓库已变化，请刷新后重试。'));
  };
  const off = client.onEvent((event) => {
    if (event.type === 'events.resync-required') for (const id of versions.keys()) bump(id);
    else if (event.type === 'repositories.changed' && event.resource) bump(key(event.resource));
  });
  async function invalidate(resource: ResourceRef) {
    const id = key(resource);
    bump(id);
    dirty.add(id);
    await client.invalidateRepository(resource);
    dirty.delete(id);
  }
  async function readOnce(resource: ResourceRef, invocation: Invocation) {
    if (disposed) throw new Error('Agent 查询适配器已关闭。');
    const id = key(resource);
    if (dirty.has(id)) await invalidate(resource);
    const version = versions.get(id) ?? 0;
    versions.set(id, version);
    const controller = new AbortController();
    const active = pending.get(id) ?? new Set<AbortController>();
    active.add(controller);
    pending.set(id, active);
    const signal = invocation.signal
      ? AbortSignal.any([invocation.signal, controller.signal])
      : controller.signal;
    try {
      const params = JSON.parse(JSON.stringify(invocation.params));
      const result = await client.readRepository(
        resource,
        invocation.kind,
        params as RepositoryQueryMap[RepositoryQueryKind]['params'],
        { signal },
      );
      signal.throwIfAborted();
      if (disposed || versions.get(id) !== version)
        throw new Error('仓库读取结果已过期，请刷新后重试。');
      return invocation.select ? invocation.select(result) : result;
    } catch (error) {
      // An in-flight query may reject with the wire's generic
      // cancellation after a locally observed Git change. Only that case is
      // superseded; a timeout or real verification failure remains visible.
      if (
        liveQueries.has(invocation.kind) &&
        !disposed &&
        !invocation.signal?.aborted &&
        controller.signal.aborted &&
        versions.get(id) !== version &&
        (error === controller.signal.reason ||
          (error instanceof ProtocolError &&
            error.kind === 'cancelled' &&
            error.outcome !== 'unknown'))
      )
        throw superseded;
      throw error;
    } finally {
      active.delete(controller);
      if (!active.size) pending.delete(id);
    }
  }
  async function query(resource: ResourceRef, invocation: Invocation) {
    // A refresh belongs to this invocation, not a subsequently edited caller object.
    invocation = { ...invocation, params: JSON.parse(JSON.stringify(invocation.params)) };
    // A mutation can supersede an already-dispatched live metadata read.
    // Repeat only that read against the same owner. Other protocol
    // errors (including an actually changed log page) are never retried.
    let delay = 120;
    for (;;) {
      try {
        return await readOnce(resource, invocation);
      } catch (error) {
        if (error !== superseded) throw error;
        const signal = invocation.signal
          ? AbortSignal.any([invocation.signal, lifetime.signal])
          : lifetime.signal;
        await new Promise<void>((resolve, reject) => {
          signal.throwIfAborted();
          const stop = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', stop);
            resolve();
          }, delay);
          signal.addEventListener('abort', stop, { once: true });
        });
        delay = Math.min(1000, delay * 2);
      }
    }
  }
  function wrap<T extends object>(
    legacy: T,
    queries: Partial<Record<keyof T, Query>>,
    isWrite: (name: string) => boolean,
  ): T {
    return Object.fromEntries(
      Object.entries(legacy).map(([name, fn]) => [
        name,
        async (...args: any[]) => {
          // Capture once; reconnecting or changing selection cannot reroute an in-flight task.
          const resource = typeof args[0] === 'string' ? resolve(args[0]) : undefined;
          if (!resource) return fn(...args);
          const read = queries[name as keyof T];
          if (read) return query({ ...resource }, read(...args));
          if (executor === 'agent') {
            if (disposed) throw new Error('Agent 适配器已关闭。');
            const target = { ...resource },
              id = key(target);
            if (legacy === (legacyGit as object)) {
              if (name === 'operation') {
                const op = await client.repositoryOperation(target);
                if (op) observed.set(id, op.operationId);
                else observed.delete(id);
                return op;
              }
              if (name === 'cancel') {
                const op = args[1] ?? observed.get(id);
                if (!op) throw new Error('操作已结束或尚未开始，请刷新状态。');
                return client.cancelRepositoryWrite(target, op);
              }
              if (!isRepositoryWriteKind(name)) throw new Error('Agent 不支持此 Git 操作。');
              const intent = {
                resource: target,
                kind: name,
                args: (name === 'removeWorktree'
                  ? [args[1], true]
                  : args.slice(1)) as RepositoryWriteArgs<RepositoryWriteKind>,
              };
              const revision = await client.prepareRepositoryWrite(intent);
              if (disposed) throw new Error('Agent 适配器已关闭。');
              const operationId = crypto.randomUUID();
              observed.set(id, operationId);
              bump(id);
              try {
                const value = await client.writeRepository({ ...intent, revision, operationId });
                return name === 'createWorktree' ? remember(value, target) : value;
              } catch (error) {
                if (
                  error instanceof ProtocolError &&
                  error.details &&
                  typeof error.details === 'object' &&
                  'code' in error.details &&
                  error.details.code === 'LOCAL_BRANCH_EXISTS'
                )
                  throw Object.assign(error, { response: { data: error.details } });
                if (error instanceof ProtocolError && error.outcome !== 'unknown') throw error;
                const receipt = await client.getTask({ taskId: operationId }).catch(() => null);
                throw new Error(
                  `${error instanceof Error ? error.message : 'Git 操作未完成'}（操作 ${operationId}；${receipt?.task?.state === 'succeeded' ? '已执行成功，响应丢失' : '请刷新仓库核对结果'}，请勿重复执行。）`,
                );
              } finally {
                if (observed.get(id) === operationId) observed.delete(id);
                bump(id);
              }
            }
            if (name === 'openWorktree' || name === 'openSubmodule')
              return remember(
                await client.openRelatedRepository(
                  target,
                  args[1],
                  name === 'openWorktree' ? 'worktree' : 'submodule',
                ),
                target,
              );
          }
          if (!isWrite(name)) return fn(...args);
          const target = { ...resource };
          await invalidate(target);
          try {
            return await fn(...args);
          } finally {
            // A failed/unknown legacy write is still not replayed. A lost invalidation
            // leaves reads blocked on a fresh invalidation without falsifying write success.
            await invalidate(target).catch(() => {});
          }
        },
      ]),
    ) as T;
  }
  const repository = wrap(legacyRepository, repositoryQueries, (name) =>
    legacyRepositoryWrites.has(name),
  );
  repository.analytics = async (ids, collect = false, refresh = false, signal) => {
    const selected = ids.map((id) => ({ id, resource: resolve(id) }));
    const resources = selected.flatMap((item) => (item.resource ? [item.resource] : []));
    const other = selected.filter((item) => !item.resource).map((item) => item.id);
    for (const resource of resources) if (dirty.has(key(resource))) await invalidate(resource);
    const epochs = resources.map((resource) => {
      const id = key(resource),
        version = versions.get(id) ?? 0;
      versions.set(id, version);
      return { id, version };
    });
    const [agent, legacy] = await Promise.all([
      resources.length ? client.repositoryAnalytics(resources, collect, refresh, { signal }) : [],
      other.length ? legacyRepository.analytics(other, collect, refresh, signal) : [],
    ]);
    if (disposed || epochs.some((e) => versions.get(e.id) !== e.version))
      throw new Error('仓库统计已过期，请刷新后重试。');
    return selected.map((item) =>
      item.resource
        ? { ...agent.find((entry) => entry.id === item.resource!.resourceId), id: item.id }
        : (legacy.find((entry) => entry.id === item.id) ?? { id: item.id }),
    );
  };
  return {
    repository,
    git: wrap(
      legacyGit,
      executor === 'agent' ? { ...gitQueries, ...previews } : gitQueries,
      (name) => name !== 'operation' && !Object.hasOwn(previews, name),
    ),
    invalidate,
    dispose() {
      disposed = true;
      lifetime.abort(new Error('Agent 查询适配器已关闭。'));
      off();
      for (const id of pending.keys()) bump(id);
      pending.clear();
      versions.clear();
      dirty.clear();
    },
  };
}

/** Install only after the caller has explicitly selected registered test resources.
 * Restoring the original APIs is synchronous; existing requests retain their executor.
 */
export function installAgentRepositoryQueries(
  client: AgentClient,
  resourceFor: (id: string) => ResourceRef | undefined,
  repository: RepositoryApi,
  git: GitApi,
) {
  const originals = { repository: { ...repository }, git: { ...git } };
  const adapter = createAgentRepositoryQueries(
    client,
    resourceFor,
    originals.repository,
    originals.git,
  );
  Object.assign(repository, adapter.repository);
  Object.assign(git, adapter.git);
  return () => {
    adapter.dispose();
    for (const [target, installed, previous] of [
      [repository, adapter.repository, originals.repository],
      [git, adapter.git, originals.git],
    ] as const) {
      // Never overwrite a later owner's override during teardown.
      for (const name of Object.keys(installed))
        if ((target as any)[name] === (installed as any)[name])
          (target as any)[name] = (previous as any)[name];
    }
  };
}

/** F10 host-file seam: only the host router knows which registered root owns
 * the legacy connection/path. Unmapped SSH files retain the P7 transport. */
export function createAgentFileWrite(
  client: AgentClient,
  locate: (
    connectionId: string,
    path: string,
  ) => { resource: ResourceRef; relativePath: string } | undefined,
  legacy: (connectionId: string, path: string, content: string) => Promise<unknown>,
) {
  return async (connectionId: string, path: string, content: string) => {
    const target = locate(connectionId, path);
    if (!target) return legacy(connectionId, path, content);
    const resource = { ...target.resource };
    const preview = await client.readRepository(resource, 'previewWorkspaceFile', {
      path: target.relativePath,
    });
    const intent = {
      resource,
      kind: 'writeFile' as const,
      args: [target.relativePath, content, preview.token] as [string, string, string],
    };
    const operationId = crypto.randomUUID(),
      revision = await client.prepareRepositoryWrite(intent);
    try {
      return await client.writeRepository({ ...intent, operationId, revision });
    } catch (error) {
      if (error instanceof ProtocolError && error.outcome !== 'unknown') throw error;
      throw new Error(`文件写入结果未知（操作 ${operationId}），请查询状态并核对文件。`, {
        cause: error,
      });
    }
  };
}
