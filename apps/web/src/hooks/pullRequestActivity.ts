import type { AgentClient } from '@alune/agent-client';
import {
  ProtocolError,
  type PullRequestActivityQuery,
  type PullRequestActivityPage,
  type PullRequestItem,
  type PullRequestProvider,
} from '@alune/protocol';

const PROJECTS_PER_CHECK = 4;
const REQUESTS_PER_PROJECT = 4;
const MAX_TRACKED_REQUESTS = 120;
const MAX_REVIEW_STATES = 1_000;
const MAX_PUBLISHED_EVENTS = 2_000;
const COMMENT_OVERLAP_MS = 1_000;
export const pullRequestActivityScope = 'pull-request-activity:';

type Client = Pick<AgentClient, 'listAccessTokens' | 'collaboration'>;
type Target = Pick<PullRequestActivityQuery, 'remote' | 'target' | 'provider' | 'selectionVersion'>;
type Kind = PullRequestActivityQuery['kind'];
type Source = Omit<Target, 'selectionVersion'> & {
  repositoryId: string;
  tokenId: string;
  tokenVersion: string;
  scope: string;
};
type Stream = {
  since: number;
  startedAt: number;
  page: number;
  notes: Map<string, number>;
  reviews: Map<string, string>;
  approvalState?: string;
};
type Observation = {
  item: PullRequestItem;
  streams: Map<Kind, Stream>;
  checkedUpdate?: string;
};
type Project = {
  beganAt: number;
  nextPage: number;
  observed: Map<number, Observation>;
};
export type PullRequestActivityNotice = {
  id: string;
  scope: string;
  title: string;
  description: string;
  path: string;
};

function notifyActivity(
  source: Source,
  version: string,
  item: PullRequestItem,
  event: string,
  description: string,
) {
  const query = new URLSearchParams({
    remote: source.remote,
    target: source.target,
    actorVersion: version,
  });
  const label = source.provider === 'github' ? `PR #${item.number}` : `MR !${item.number}`;
  return {
    id: JSON.stringify([source.scope, item.number, event]),
    scope: source.scope,
    title: `${label} ${description}`,
    description: `${item.title} · ${new URL(source.target).pathname.slice(1)}`,
    path: `/pull-requests/${encodeURIComponent(source.repositoryId)}/${item.number}?${query}`,
  } satisfies PullRequestActivityNotice;
}

function kinds(provider: PullRequestProvider): Kind[] {
  return provider === 'github' ? ['comments', 'code', 'reviews'] : ['comments', 'approvals'];
}

function observeStream(stream: Stream, result: PullRequestActivityPage, kind: Kind) {
  const changes = [];
  if (kind === 'approvals') {
    if (stream.approvalState !== undefined && stream.approvalState !== result.approvalState)
      changes.push(`${stream.approvalState}:${result.approvalState}`);
    stream.approvalState = result.approvalState;
    return changes;
  }
  for (const entry of result.entries) {
    const createdAt = Date.parse(entry.createdAt);
    if (kind === 'reviews' && entry.state) {
      const previous = stream.reviews.get(entry.id);
      if (previous === entry.state) continue;
      if (previous !== undefined || createdAt >= stream.since)
        changes.push(`${entry.id}:${entry.state}:${entry.createdAt}`);
      stream.reviews.set(entry.id, entry.state);
      if (stream.reviews.size > MAX_REVIEW_STATES)
        stream.reviews.delete(stream.reviews.keys().next().value!);
    } else if (createdAt >= stream.since && !stream.notes.has(entry.id)) {
      stream.notes.set(entry.id, createdAt);
      changes.push(entry.id);
    }
  }
  stream.page = result.hasMore ? stream.page + 1 : 1;
  if (!result.hasMore) {
    stream.since = Math.max(stream.since, stream.startedAt - COMMENT_OVERLAP_MS);
    for (const [id, date] of stream.notes) if (date < stream.since) stream.notes.delete(id);
  }
  return changes;
}

function providerLimited(error: unknown) {
  return error instanceof ProtocolError && error.kind === 'overloaded';
}

export function createPullRequestActivityPoller() {
  const projects = new Map<string, Project>();
  const sourceOffsets = new Map<string, number>();
  const published = new Map<string, Set<string>>();
  let nextProject = 0;

  return async (
    client: Client,
    agentId: string,
    excludedRepositories: ReadonlySet<string>,
    signal: AbortSignal,
    publish: (notice: PullRequestActivityNotice) => void,
    retainScopes: (scopes: ReadonlySet<string>) => void,
  ) => {
    const { tokens } = await client.listAccessTokens({ signal });
    signal.throwIfAborted();
    const candidates = new Map<string, Source[]>();
    const allowedScopes = new Set<string>();
    for (const token of tokens) {
      if (!token.scope) continue;
      for (const association of token.associations) {
        if (excludedRepositories.has(association.repositoryId)) continue;
        const key = JSON.stringify([token.scope.provider, association.target.toLowerCase()]);
        const scope = `${pullRequestActivityScope}${JSON.stringify([key, token.id, token.version])}`;
        allowedScopes.add(scope);
        const group = candidates.get(key) ?? [];
        group.push({
          repositoryId: association.repositoryId,
          remote: association.remote,
          target: association.target,
          provider: token.scope.provider,
          tokenId: token.id,
          tokenVersion: token.version,
          scope,
        });
        candidates.set(key, group);
      }
    }
    for (const key of projects.keys()) if (!allowedScopes.has(key)) projects.delete(key);
    for (const key of sourceOffsets.keys()) if (!candidates.has(key)) sourceOffsets.delete(key);
    for (const key of published.keys()) if (!candidates.has(key)) published.delete(key);
    retainScopes(allowedScopes);

    const groups = [...candidates.entries()];
    for (let count = 0; count < Math.min(PROJECTS_PER_CHECK, groups.length); count++) {
      signal.throwIfAborted();
      const [key, group] = groups[nextProject % groups.length];
      nextProject = (nextProject + 1) % groups.length;
      const offset = (sourceOffsets.get(key) ?? 0) % group.length;
      const source = group[offset];
      const resource = { agentId, resourceId: source.repositoryId };
      try {
        // Direct requests on the credentials-owning Agent reuse SSH only if the
        // registered repository already has a live binding.
        const remotes = await client.collaboration('reviews.remotes', { resource }, { signal });
        signal.throwIfAborted();
        const remote = remotes.find((remote) => remote.name === source.remote);
        const selection = remote?.selection;
        if (
          !remote ||
          remote.webUrl !== source.target ||
          remote.unavailableReason ||
          selection?.status !== 'applied' ||
          selection.tokenId !== source.tokenId ||
          selection.provider !== source.provider ||
          !selection.version.endsWith(`:${source.tokenVersion}`)
        ) {
          sourceOffsets.set(key, offset + 1);
          continue;
        }
        const target: Target = {
          remote: source.remote,
          provider: source.provider,
          target: source.target,
          selectionVersion: selection.version,
        };
        const seen = published.get(key) ?? new Set<string>();
        published.set(key, seen);
        const emit = (
          item: PullRequestItem,
          kind: string,
          events: string[],
          description: (count: number) => string,
        ) => {
          const ids = events.map((event) => JSON.stringify([item.number, kind, event]));
          const fresh = ids.filter((id) => !seen.has(id));
          if (!fresh.length) return;
          for (const id of fresh) seen.add(id);
          while (seen.size > MAX_PUBLISHED_EVENTS) seen.delete(seen.keys().next().value!);
          publish(
            notifyActivity(
              source,
              selection.version,
              item,
              JSON.stringify(fresh.sort()),
              description(fresh.length),
            ),
          );
        };
        const existing = projects.get(source.scope);
        const project = existing ?? { beganAt: Date.now(), nextPage: 1, observed: new Map() };
        const list = async (page: number) => {
          const response = await client.collaboration(
            'reviews.list',
            {
              resource,
              input: { ...target, state: 'all', page },
            },
            { signal },
          );
          signal.throwIfAborted();
          for (const item of response.items) {
            const prior = project.observed.get(item.number);
            const updatedAt = Date.parse(item.updatedAt);
            if (prior && updatedAt < Date.parse(prior.item.updatedAt)) continue;
            if (!prior && item.state !== 'open' && updatedAt < project.beganAt) continue;
            if (
              existing &&
              item.state === 'merged' &&
              (prior
                ? prior.item.state !== 'merged'
                : Date.parse(item.mergedAt ?? '') >= project.beganAt)
            )
              emit(item, 'merge', ['merged'], () => '已合并');
            if (prior) prior.item = item;
            else project.observed.set(item.number, { item, streams: new Map() });
          }
          return response.hasMore;
        };
        const more = await list(1);
        projects.set(source.scope, project);
        project.nextPage = more
          ? project.nextPage === 1
            ? 2
            : (await list(project.nextPage))
              ? project.nextPage + 1
              : 2
          : 1;

        // Refresh the latest changes first, then rotate older open requests
        // through the same budget so approval-only changes can still be found.
        const observed = [...project.observed.values()].filter(
          ({ item, checkedUpdate }) => item.state === 'open' || item.updatedAt !== checkedUpdate,
        );
        const changed = observed
          .filter(
            ({ item, checkedUpdate }) =>
              item.updatedAt !== checkedUpdate && Date.parse(item.updatedAt) >= project.beganAt,
          )
          .sort((a, b) => Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt))
          .slice(0, 2);
        const selected = [...changed, ...observed.filter((entry) => !changed.includes(entry))];
        for (const observation of selected.slice(0, REQUESTS_PER_PROJECT)) {
          const { item, streams } = observation;
          signal.throwIfAborted();
          const checked = await Promise.allSettled(
            kinds(source.provider).map(async (kind) => {
              const stream = streams.get(kind) ?? {
                since: project.beganAt,
                startedAt: 0,
                page: 1,
                notes: new Map<string, number>(),
                reviews: new Map<string, string>(),
              };
              if (stream.page === 1) stream.startedAt = Date.now();
              streams.set(kind, stream);
              const response = await client.collaboration(
                'reviews.activity',
                {
                  resource,
                  input: {
                    ...target,
                    number: item.number,
                    kind,
                    page: stream.page,
                    since: new Date(stream.since).toISOString(),
                  },
                },
                { signal },
              );
              signal.throwIfAborted();
              const changes = observeStream(stream, response, kind);
              if (changes.length) {
                const review = kind === 'reviews' || kind === 'approvals';
                emit(item, kind, changes, (count) =>
                  review ? '审阅状态有变化' : `有 ${count} 条新评论`,
                );
              }
            }),
          );
          signal.throwIfAborted();
          const limited = checked.find(
            (result) => result.status === 'rejected' && providerLimited(result.reason),
          );
          if (limited?.status === 'rejected') throw limited.reason;
          if (
            [...streams.values()].every((stream) => stream.page === 1) &&
            (item.state !== 'open' || checked.every((result) => result.status === 'fulfilled'))
          ) {
            observation.checkedUpdate = item.updatedAt;
          }
          project.observed.delete(item.number);
          project.observed.set(item.number, observation);
        }
        while (project.observed.size > MAX_TRACKED_REQUESTS)
          project.observed.delete(project.observed.keys().next().value!);
      } catch (error) {
        signal.throwIfAborted();
        if (providerLimited(error)) return;
        if (error instanceof ProtocolError && error.kind === 'permission-denied') {
          allowedScopes.delete(source.scope);
          retainScopes(allowedScopes);
        }
        sourceOffsets.set(key, offset + 1);
      }
    }
  };
}
