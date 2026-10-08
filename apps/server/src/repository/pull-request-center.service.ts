import {
  BadRequestException,
  GoneException,
  HttpException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  PullRequestCenterItem,
  PullRequestCenterPage,
  PullRequestCenterQuery,
  PullRequestSource,
  PullRequestSources,
  Repository,
} from '@alune/shared';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from './repository.service';
import { PullRequestsService } from './pull-requests.service';

const TTL = 10 * 60_000;
const PAGE_SIZE = 30;
type StreamItem = Awaited<
  ReturnType<PullRequestsService['centerPage']>
>['items'][number];
type Discovery = {
  connectionNames: Record<string, string>;
  repositories: Repository[];
  sources: PullRequestSource[];
  offset: number;
  touched: number;
  steps: Map<number, Promise<PullRequestSources>>;
};
type Stream = {
  source: PullRequestSource;
  page: number;
  more: boolean;
  buffer: StreamItem[];
};
type QuerySession = {
  query: PullRequestCenterQuery;
  sources: PullRequestSource[];
  streams: Stream[];
  seen: Set<string>;
  step: number;
  touched: number;
  steps: Map<number, Promise<PullRequestCenterPage>>;
};

export function centerProjectKey(
  provider: string,
  host: string,
  project: string,
) {
  return `${provider}:${host.toLowerCase()}:${project.toLowerCase()}`;
}
export function centerQuery(input: unknown): PullRequestCenterQuery {
  const q = input as PullRequestCenterQuery;
  if (
    !q ||
    !['all', 'created', 'review'].includes(q.view) ||
    !['all', 'open', 'closed', 'merged'].includes(q.state) ||
    !['', 'github', 'gitlab'].includes(q.provider) ||
    typeof q.account !== 'string' ||
    q.account.length > 512 ||
    typeof q.search !== 'string' ||
    q.search.length > 500 ||
    !Array.isArray(q.projects) ||
    q.projects.length > 500 ||
    q.projects.some((p) => typeof p !== 'string' || p.length > 4096)
  )
    throw new BadRequestException('中心筛选条件无效。');
  return {
    view: q.view,
    state: q.state,
    provider: q.provider,
    account: q.account,
    search: q.search.trim().toLowerCase(),
    projects: [...new Set(q.projects)].sort(),
  };
}
function safeError(error: unknown) {
  return error instanceof HttpException
    ? error.message
    : '无法读取此来源，请检查连接后重试。';
}
function cursorParts(cursor: unknown): [string, number] {
  if (typeof cursor !== 'string' || !/^[\da-f-]{36}:\d{1,7}$/.test(cursor))
    throw new BadRequestException('分页游标无效，请刷新中心。');
  const [id, step] = cursor.split(':');
  return [id, Number(step)];
}

@Injectable()
export class PullRequestCenterService {
  private active = 0;
  private waiting: Array<() => void> = [];
  private async withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 4)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  context(repositoryId: string, query: unknown) {
    return this.withSlot(async () => {
      const result = await this.requests.centerPage(repositoryId, query);
      return { account: result.account, identityNotice: result.identityNotice };
    });
  }

  private discoveries = new Map<string, Discovery>();
  private queries = new Map<string, QuerySession>();
  constructor(
    private readonly repositories: RepositoryService,
    private readonly requests: PullRequestsService,
    @Optional() private readonly connections?: ConnectionService,
  ) {}

  private prune<T extends { touched: number }>(entries: Map<string, T>) {
    for (const [id, entry] of entries)
      if (entry.touched + TTL < Date.now()) entries.delete(id);
    while (entries.size >= 24) entries.delete(entries.keys().next().value!);
  }

  async discover(input: { cursor?: string } = {}): Promise<PullRequestSources> {
    let id: string, step: number, session: Discovery;
    if (input.cursor) {
      [id, step] = cursorParts(input.cursor);
      session = this.discoveries.get(id)!;
      if (!session || session.touched + TTL < Date.now())
        throw new GoneException('来源快照已过期，请刷新中心。');
    } else {
      this.prune(this.discoveries);
      id = randomUUID();
      step = 0;
      const connectionNames = Object.fromEntries(
        ((await this.connections?.list()) || []).map((connection) => [
          connection.id,
          connection.name || connection.host,
        ]),
      );
      session = {
        connectionNames,
        repositories: await this.repositories.list(),
        sources: [],
        offset: 0,
        touched: Date.now(),
        steps: new Map(),
      };
      this.discoveries.set(id, session);
    }
    session.touched = Date.now();
    const existing = session.steps.get(step);
    if (existing) return existing;
    if (step !== session.offset)
      throw new BadRequestException('来源游标不连续，请刷新中心。');
    const work = (async () => {
      // A request processes one bounded wave, so slow SSH hosts cannot hold the entire center open.
      const batch = session.repositories.slice(step, step + 4);
      const results = await Promise.all(
        batch.map(async (repo) => {
          const base = {
            repositoryId: repo.id,
            repositoryName: repo.name,
            location:
              repo.source === 'local' || !repo.connectionId
                ? `本机 · ${repo.path}`
                : `SSH ${session.connectionNames[repo.connectionId!] || repo.connectionId} · ${repo.path}`,
            account: null,
          };
          try {
            const remotes = await this.withSlot(() =>
              this.requests.remotes(repo.id),
            );
            if (!remotes.length)
              return [
                {
                  ...base,
                  id: `${repo.id}:none`,
                  remote: null,
                  provider: null,
                  projectKey: null,
                  status: 'unsupported',
                  message: '此仓库尚未配置远端。',
                } satisfies PullRequestSource,
              ];
            return remotes.map((remote): PullRequestSource => {
              const provider =
                remote.provider || remote.selection?.provider || null;
              const invalid = ['target-changed', 'token-deleted'].includes(
                remote.selection?.status || '',
              );
              return {
                ...base,
                id: `${repo.id}:${remote.name}`,
                remote,
                provider,
                projectKey: provider
                  ? centerProjectKey(provider, remote.host, remote.project)
                  : null,
                status: remote.unavailableReason
                  ? 'unsupported'
                  : !provider || invalid
                    ? 'configuration'
                    : 'ready',
                message:
                  remote.unavailableReason ||
                  (invalid
                    ? '远端或令牌已变化，请重新关联。'
                    : !provider
                      ? '请确认自建 GitLab 平台并配置访问方式。'
                      : undefined),
              };
            });
          } catch (error) {
            return [
              {
                ...base,
                id: `${repo.id}:error`,
                remote: null,
                provider: null,
                projectKey: null,
                status: 'error',
                message: safeError(error),
              } satisfies PullRequestSource,
            ];
          }
        }),
      );
      session.sources.push(...results.flat());
      session.offset += batch.length;
      const complete = session.offset >= session.repositories.length;
      return structuredClone({
        discoveryId: id,
        sources: session.sources,
        repositoryCount: session.repositories.length,
        discoveredCount: session.offset,
        complete,
        cursor: complete ? null : `${id}:${session.offset}`,
      });
    })();
    session.steps.set(step, work);
    return work;
  }

  async list(input: {
    discoveryId?: string;
    query?: unknown;
    cursor?: string;
  }): Promise<PullRequestCenterPage> {
    let id: string, step: number, session: QuerySession;
    if (input.cursor) {
      [id, step] = cursorParts(input.cursor);
      session = this.queries.get(id)!;
      if (!session || session.touched + TTL < Date.now())
        throw new GoneException('列表快照已过期，请刷新中心。');
    } else {
      const discovery = this.discoveries.get(input.discoveryId || '');
      if (!discovery || discovery.touched + TTL < Date.now())
        throw new GoneException('来源快照已过期，请刷新中心。');
      if (discovery.offset !== discovery.repositories.length)
        throw new BadRequestException('请先完成来源发现。');
      const query = centerQuery(input.query);
      this.prune(this.queries);
      id = randomUUID();
      step = 0;
      const sources = structuredClone(discovery.sources);
      session = {
        query,
        sources,
        streams: sources
          .filter(
            (s) =>
              s.status === 'ready' &&
              (!query.provider || s.provider === query.provider) &&
              (!query.projects.length ||
                query.projects.includes(s.projectKey!)),
          )
          .map((source) => ({ source, page: 1, more: true, buffer: [] })),
        seen: new Set(),
        step: 0,
        touched: Date.now(),
        steps: new Map(),
      };
      this.queries.set(id, session);
    }
    session.touched = Date.now();
    const existing = session.steps.get(step);
    if (existing) return existing;
    if (session.step !== step)
      throw new BadRequestException('列表游标不连续，请刷新中心。');
    const work = this.advance(session, id, step);
    session.steps.set(step, work);
    return work;
  }

  private async advance(
    session: QuerySession,
    id: string,
    step: number,
  ): Promise<PullRequestCenterPage> {
    const { query, streams } = session;
    const needsHead = (s: Stream) => !s.buffer.length && s.more;
    await Promise.all(
      streams
        .filter(needsHead)
        .slice(0, 4)
        .map(async (stream) => {
          const { source } = stream;
          try {
            const result = await this.withSlot(() =>
              this.requests.centerPage(source.repositoryId, {
                remote: source.remote!.name,
                target: source.remote!.webUrl,
                provider: source.provider!,
                selectionVersion: source.remote!.selection?.version || '',
                state:
                  query.view === 'review' || query.state === 'open'
                    ? 'open'
                    : 'all',
                page: stream.page,
              }),
            );
            source.account = result.account;
            source.identityNotice = result.identityNotice;
            source.status = 'success';
            stream.buffer = result.items;
            stream.more = result.hasMore;
            stream.page++;
          } catch (error) {
            source.status = 'error';
            source.message = safeError(error);
            stream.more = false;
          }
        }),
    );
    const items: PullRequestCenterItem[] = [];
    // Emit only after every live stream has a head: otherwise a later repository could
    // introduce a newer item behind an already delivered page. Filtering happens after
    // advancing the merge, so an empty matched page never truncates the upstream scan.
    while (items.length < PAGE_SIZE && !streams.some(needsHead)) {
      const next = streams
        .filter((s) => s.buffer.length)
        .sort(
          (a, b) =>
            Date.parse(b.buffer[0].updatedAt) -
              Date.parse(a.buffer[0].updatedAt) ||
            a.source.id.localeCompare(b.source.id),
        )[0];
      if (!next) break;
      const { reviewers, ...item } = next.buffer.shift()!;
      const source = next.source;
      const key = `${source.projectKey}:${item.number}`;
      const account = source.account;
      const username = account?.username.toLowerCase();
      if (
        session.seen.has(key) ||
        (query.state !== 'all' && query.state !== item.state) ||
        (query.account && account?.key !== query.account) ||
        (query.view === 'created' &&
          (!username || item.author.toLowerCase() !== username)) ||
        (query.view === 'review' &&
          (!username ||
            item.state !== 'open' ||
            !reviewers.some((r) => r.toLowerCase() === username))) ||
        (query.search &&
          ![
            item.title,
            String(item.number),
            `#${item.number}`,
            `!${item.number}`,
            item.author,
            item.sourceBranch,
            item.targetBranch,
          ]
            .join(' ')
            .toLowerCase()
            .includes(query.search))
      )
        continue;
      session.seen.add(key);
      items.push({
        ...item,
        key,
        projectKey: source.projectKey!,
        sourceId: source.id,
        sourceIds: session.sources
          .filter((s) => s.projectKey === source.projectKey)
          .map((s) => s.id),
        provider: source.provider!,
        project: source.remote!.project,
        host: source.remote!.host,
      });
    }
    session.step++;
    const more = streams.some((s) => s.more || s.buffer.length);
    return structuredClone({
      items,
      sources: session.sources,
      nextCursor: more ? `${id}:${step + 1}` : null,
      scanning: more && items.length === 0,
      completedSources: streams.filter((s) => !s.more && !s.buffer.length)
        .length,
      totalSources: streams.length,
      updatedAt: new Date().toISOString(),
    });
  }
}
