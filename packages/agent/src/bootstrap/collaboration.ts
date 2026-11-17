import type { HostRepositoryReads } from '../ports/host-repository-reads';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  MAX_FRAME_BYTES,
  ProtocolError,
  validateCollaboration,
  type CollaborationMethods,
  type JsonValue,
} from '@alune/protocol';
import type { Handler, HandlerContext } from '../ports/handler';
import type { ReviewRepositories } from '../ports/review-repositories';
import { isProviderError } from '../ports/provider-error';
import type { TraceHttp } from '../ports/provider-http';
import { StateFault } from '../ports/state';
import { AiService } from '../modules/ai/service';
import { StagedChanges } from '../modules/git/staged-changes';
import { GitReads } from '../modules/git/git-commands';
import { pullRequestBranch } from '../modules/git/pull-request-branch';
import {
  PullRequestsService,
  validatePullRequestDetailQuery,
} from '../modules/reviews/pull-requests.service';
import { validateMutation } from '../modules/reviews/pull-request-actions';
import {
  PullRequestCreationService,
  validateCreate,
} from '../modules/reviews/pull-request-creation.service';
import { PullRequestCenterService } from '../modules/reviews/pull-request-center.service';
import type { RepositoryCatalog } from '../modules/repositories/catalog';
import type { RepositoryTransport } from '../ports/repository-files';
import type { settingsKernel } from './settings-kernel';
import { workspaceGroups } from '../modules/workspace/groups';

export function collaborationKernel(
  catalog: RepositoryCatalog,
  settings: ReturnType<typeof settingsKernel>,
  connect: (signal: AbortSignal) => Promise<RepositoryTransport>,
  aiFetch: typeof fetch,
  trace: TraceHttp,
  hosts?: HostRepositoryReads,
) {
  const current = new AsyncLocalStorage<AbortSignal>();
  const ref = (id: string) => ({ agentId: catalog.agentId, resourceId: id });
  function route(id: string) {
    const repo = catalog.get(ref(id), false);
    if (repo.source === 'ssh' && !hosts)
      throw new ProtocolError('unavailable', '远端 Agent 未连接，请重新连接对应主机。');
    return repo;
  }
  async function read<T>(
    id: string,
    signal: AbortSignal,
    work: (transport: RepositoryTransport, path: string) => Promise<T>,
  ) {
    const repo = catalog.get(ref(id));
    const transport = await connect(signal);
    try {
      return await work(transport, repo.path);
    } finally {
      await transport.close?.();
    }
  }
  const repos: ReviewRepositories = {
    list: async () => catalog.list(),
    getRemotes: (id, signal) => {
      const repo = route(id);
      return repo.source === 'ssh'
        ? hosts!.remotes(repo, signal)
        : read(id, signal, (conn, path) => new GitReads(conn).remoteList(path, signal));
    },
    pullRequestBranch: (id, branch, signal = AbortSignal.timeout(20000)) => {
      const repo = route(id);
      return repo.source === 'ssh'
        ? hosts!.branch(repo, branch, signal)
        : read(id, signal, (conn, path) => pullRequestBranch(conn, path, branch, signal));
    },
  };
  const reviews = new PullRequestsService(repos, settings.tokens, trace, () => current.getStore());
  const creation = new PullRequestCreationService(repos, reviews);
  const center = new PullRequestCenterService(repos, reviews, {
    list: () => settings.hosts.list().hosts,
  });
  const ai = new AiService(
    settings.ai,
    async (id, signal) => {
      const repo = route(id);
      if (repo.source === 'ssh') return hosts!.openStaged(repo, signal);
      const transport = await connect(signal);
      return {
        staged: new StagedChanges(transport, repo.path),
        release: () => transport.close?.(),
      };
    },
    aiFetch,
    creation,
    trace,
  );

  type Key = keyof CollaborationMethods;
  type Params<K extends Key> = CollaborationMethods[K][0];
  const handlers: Record<string, Handler> = {};
  function register<K extends Key>(
    method: K,
    run: (p: Params<K>, c: HandlerContext) => unknown,
    effect: Handler['effect'] = 'query',
  ) {
    const journalById = method === 'reviews.mutate' || method === 'reviews.create';
    handlers[method] = {
      minimumProtocolMinor: 5,
      effect,
      validate(value) {
        const p = validateCollaboration(method, value);
        // Reject malformed writes before the durable journal reserves their ID.
        if (journalById && 'input' in p) {
          try {
            if (method === 'reviews.create') validateCreate(p.input);
            else {
              validatePullRequestDetailQuery(p.input);
              validateMutation(p.input);
            }
          } catch (error) {
            if (isProviderError(error)) throw new ProtocolError('invalid-params', error.message);
            throw error;
          }
        }
        if ('resource' in p && p.resource.agentId !== catalog.agentId)
          throw new ProtocolError('not-found', 'Repository belongs to another Agent');
      },
      ...(journalById
        ? {
            operationId: (value: unknown) =>
              (value as Params<'reviews.mutate' | 'reviews.create'>).input.operationId,
          }
        : {}),
      async run(p, c) {
        const signal = AbortSignal.any([c.signal, c.sessionSignal]);
        try {
          if (method !== 'workspace.groups') await settings.readyCredentials(signal);
          signal.throwIfAborted();
          const result = await current.run(signal, () => run(p as Params<K>, c));
          signal.throwIfAborted();
          const encoded = JSON.stringify(result);
          if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES - 4096)
            throw new ProtocolError(
              'overloaded',
              '协作响应超过单次读取上限，请缩小查询范围。',
              journalById ? 'unknown' : 'completed',
            );
          return JSON.parse(encoded) as JsonValue;
        } catch (error) {
          if (error instanceof ProtocolError || error instanceof StateFault) throw error;
          if (signal.aborted)
            throw new ProtocolError(
              'cancelled',
              '请求已取消，请核对当前状态。',
              effect === 'mutation' ? 'unknown' : 'completed',
            );
          if (!isProviderError(error)) throw error;
          const s = error.getStatus();
          throw new ProtocolError(
            s === 409 || s === 410
              ? 'conflict'
              : s === 404
                ? 'not-found'
                : s === 401 || s === 403
                  ? 'permission-denied'
                  : s === 429 || s === 413
                    ? 'overloaded'
                    : s === 504
                      ? 'timeout'
                      : s === 499
                        ? 'cancelled'
                        : s >= 500
                          ? 'unavailable'
                          : 'invalid-params',
            error.message,
            journalById && s >= 500 ? 'unknown' : 'not-started',
            { status: s },
          );
        }
      },
    };
  }
  register('workspace.groups', () =>
    workspaceGroups(catalog.agentId, settings.hosts.list().hosts, catalog.list()),
  );
  register('catalog.reviews.sources', (p) => center.discover(p.input));
  register('catalog.reviews.list', (p) => center.list(p.input));
  register('catalog.reviews.context', (p) => center.context(p.resource.resourceId, p.input));
  register('reviews.remotes', (p) => reviews.remotes(p.resource.resourceId));
  register('reviews.preview', (p) => creation.preview(p.resource.resourceId, p.input));
  register('reviews.create', (p) => creation.create(p.resource.resourceId, p.input), 'mutation');
  register('reviews.mutate', (p) => reviews.mutate(p.resource.resourceId, p.input), 'mutation');
  register(
    'reviews.applyToken',
    async (p, c) => {
      const result = await reviews.applyToken(p.resource.resourceId, p.input);
      c.events.notifyState('accounts.tokens.changed', { section: 'tokens' }, p.resource);
      return result;
    },
    'mutation',
  );
  register('ai.generate', (p) =>
    ai.run(current.getStore()!, (s) => ai.generate(p.resource.resourceId, p.input.revision, s)),
  );
  register('ai.generatePullRequest', (p) =>
    ai.run(current.getStore()!, (s) => ai.generatePullRequest(p.resource.resourceId, p.input, s)),
  );
  register('ai.test', (p) =>
    ai.run(current.getStore()!, (s) => ai.test(p.input.id, p.input.revision, s, p.input.modelId)),
  );
  register(
    'ai.models',
    async (p, c) => {
      const result = await ai.run(current.getStore()!, (s) =>
        ai.models(p.input.id, p.input.revision, s),
      );
      c.events.notifyState('settings.changed', { section: 'configuration' });
      return result;
    },
    'mutation',
  );
  for (const method of ['list', 'detail', 'files', 'discussions', 'actions'] as const)
    register(`reviews.${method}`, (p) => reviews[method](p.resource.resourceId, p.input));
  return handlers;
}
