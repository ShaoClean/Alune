import { ConflictException, GatewayTimeoutException } from '@nestjs/common';
import {
  PullRequestCenterService,
  centerProjectKey,
  centerQuery,
} from './pull-request-center.service';
import { PullRequestsService } from './pull-requests.service';
import { RepositoryService } from './repository.service';
import { AccessTokensService } from '../access-tokens/access-tokens.service';
import type {
  PullRequestCenterQuery,
  PullRequestCenterPage,
  PullRequestRemote,
  Repository,
} from '@alune/shared';

const query: PullRequestCenterQuery = {
  view: 'all',
  state: 'open',
  provider: '',
  search: '',
  projects: [],
  account: '',
};
const repo = (id: string): Repository => ({
  id,
  name: id,
  path: `/work/${id}`,
  source: 'local',
});
const remote = (
  project = 'team/app',
  name = 'origin',
  provider: 'github' | 'gitlab' = 'github',
): PullRequestRemote => ({
  name,
  project,
  provider,
  host: `${provider}.com`,
  webUrl: `https://${provider}.com/${project}`,
  selection: { status: 'applied', tokenId: 'token', provider, version: 'v1' },
});
const account = (username = 'alice') => ({
  key: `github:github.com:${username}`,
  username,
  host: 'github.com',
});
const item = (
  number: number,
  time = number,
  author = 'alice',
  reviewers: string[] = [],
) => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/team/app/pull/${number}`,
  state: 'open' as const,
  draft: false,
  author,
  reviewers,
  sourceBranch: `feature/${number}`,
  targetBranch: 'main',
  updatedAt: new Date(Date.UTC(2026, 9, 1, 0, time)).toISOString(),
});
function fixture(ids = ['a', 'b']) {
  const remotes = jest
    .fn()
    .mockImplementation(async (id: string) => [remote(`team/${id}`)]);
  const centerPage = jest
    .fn()
    .mockResolvedValue({ items: [], hasMore: false, account: account() });
  const service = new PullRequestCenterService(
    { list: async () => ids.map(repo) } as RepositoryService,
    { remotes, centerPage } as unknown as PullRequestsService,
  );
  return { service, remotes, centerPage };
}
async function all(service: PullRequestCenterService, filters = query) {
  let discovery = await service.discover();
  while (discovery.cursor)
    discovery = await service.discover({ cursor: discovery.cursor });
  let page = await service.list({
    discoveryId: discovery.discoveryId,
    query: filters,
  });
  const items = [...page.items];
  let rounds = 0;
  while (page.nextCursor) {
    if (++rounds > 30) throw new Error('pagination did not terminate');
    page = await service.list({ cursor: page.nextCursor });
    items.push(...page.items);
  }
  return { items, page, discovery };
}

describe('cross-repository PR/MR center', () => {
  it('discovers every remote and preserves unavailable repositories and custom-host setup', async () => {
    const f = fixture(['a', 'b', 'c']);
    f.remotes.mockImplementation(async (id) => {
      if (id === 'b') throw new GatewayTimeoutException('SSH 超时');
      if (id === 'c') return [];
      return [
        remote(),
        remote('team/upstream', 'upstream', 'gitlab'),
        {
          ...remote(),
          name: 'self-hosted',
          host: 'git.example.com',
          provider: null,
          selection: undefined,
        },
      ];
    });
    const result = await f.service.discover();
    expect(result.complete).toBe(true);
    expect(result.sources).toHaveLength(5);
    expect(result.sources.map((s) => s.status)).toEqual([
      'ready',
      'ready',
      'configuration',
      'error',
      'unsupported',
    ]);
  });

  it('merges independently paginated streams in global update order and deduplicates clones', async () => {
    const f = fixture(['a', 'clone', 'b']);
    f.remotes.mockImplementation(async (id) => [
      remote(id === 'b' ? 'team/b' : 'team/a'),
    ]);
    f.centerPage.mockImplementation(async (id, q) => ({
      account: account(),
      hasMore: q.page === 1,
      items:
        q.page === 1
          ? [item(3, id === 'b' ? 35 : 30), item(2, id === 'b' ? 25 : 20)]
          : [item(1, id === 'b' ? 15 : 10)],
    }));
    const { items } = await all(f.service);
    expect(items.map((i) => [i.project, i.number])).toEqual([
      ['team/b', 3],
      ['team/a', 3],
      ['team/b', 2],
      ['team/a', 2],
      ['team/b', 1],
      ['team/a', 1],
    ]);
    expect(items.find((i) => i.project === 'team/a')!.sourceIds).toHaveLength(
      2,
    );
    expect(f.centerPage.mock.calls.some(([, q]) => q.page === 2)).toBe(true);
  });

  it('finds a personal request beyond page one and does not mark filtered-empty pages complete', async () => {
    const f = fixture(['a']);
    f.centerPage.mockImplementation(async (_, q) => ({
      account: account(),
      hasMore: q.page === 1,
      items: q.page === 1 ? [item(2, 20, 'bob')] : [item(1, 10, 'alice')],
    }));
    const d = await f.service.discover();
    const first = await f.service.list({
      discoveryId: d.discoveryId,
      query: { ...query, view: 'created', search: 'feature/1' },
    });
    expect(first.items).toEqual([]);
    expect(first.scanning).toBe(true);
    const next = await f.service.list({ cursor: first.nextCursor! });
    expect(next.items.map((i) => i.number)).toEqual([1]);
    expect(next.nextCursor).toBeNull();
  });

  it('matches direct reviewers and each source account, not the Git author or another source account', async () => {
    const f = fixture(['a', 'b', 'anonymous']);
    f.centerPage.mockImplementation(async (id) => ({
      account:
        id === 'anonymous' ? null : account(id === 'b' ? 'bob' : 'alice'),
      hasMore: false,
      items: [item(3, 30, 'author', ['bob']), item(2, 20, 'author', ['alice'])],
    }));
    const { items, page } = await all(f.service, { ...query, view: 'review' });
    expect(items.map((i) => [i.project, i.number])).toEqual([
      ['team/b', 3],
      ['team/a', 2],
    ]);
    expect(
      page.sources.find((s) => s.repositoryId === 'anonymous')!.account,
    ).toBeNull();
  });

  it('does not discard a matching duplicate associated with a different account', async () => {
    const f = fixture(['a', 'b']);
    f.remotes.mockResolvedValue([remote()]);
    f.centerPage.mockImplementation(async (id) => ({
      account: account(id === 'a' ? 'alice' : 'bob'),
      hasMore: false,
      items: [item(1, 10, 'bob')],
    }));
    const { items } = await all(f.service, {
      ...query,
      view: 'created',
      account: account('bob').key,
    });
    expect(items).toHaveLength(1);
    expect(items[0].sourceId).toBe('b:origin');
  });

  it('keeps failures visible while serving successes and retries cursors idempotently', async () => {
    const f = fixture(['a', 'b']);
    f.centerPage.mockImplementation(async (id) => {
      if (id === 'b') throw new ConflictException('令牌已变化');
      return {
        account: account(),
        hasMore: true,
        items: Array.from({ length: 30 }, (_, n) => item(100 - n)),
      };
    });
    const d = await f.service.discover();
    const first = await f.service.list({ discoveryId: d.discoveryId, query });
    expect(first.items).toHaveLength(30);
    expect(first.sources.find((s) => s.repositoryId === 'b')).toMatchObject({
      status: 'error',
      message: '令牌已变化',
    });
    const [next, replay] = await Promise.all([
      f.service.list({ cursor: first.nextCursor! }),
      f.service.list({ cursor: first.nextCursor! }),
    ]);
    expect(next).toEqual(replay);
    expect(f.centerPage).toHaveBeenCalledTimes(3);
  });

  it('limits discovery and page reads to four concurrent sources', async () => {
    const f = fixture(Array.from({ length: 9 }, (_, n) => String(n)));
    let pending = 0,
      maximum = 0;
    f.centerPage.mockImplementation(async () => {
      maximum = Math.max(maximum, ++pending);
      await new Promise((resolve) => setTimeout(resolve, 2));
      pending--;
      return { account: account(), items: [], hasMore: false };
    });
    await all(f.service);
    expect(maximum).toBe(4);
    expect(f.remotes).toHaveBeenCalledTimes(9);
  });

  it('distinguishes merged and closed, and validates external filters and cursors', async () => {
    const f = fixture(['a']);
    f.centerPage.mockResolvedValue({
      account: account(),
      hasMore: false,
      items: [
        { ...item(2), state: 'merged' },
        { ...item(1), state: 'closed' },
      ],
    });
    expect(
      (await all(f.service, { ...query, state: 'closed' })).items.map(
        (i) => i.number,
      ),
    ).toEqual([1]);
    expect(() => centerQuery({ ...query, projects: [null] })).toThrow();
    await expect(f.service.list({ cursor: 'invalid' })).rejects.toThrow();
    expect(centerProjectKey('github', 'GitHub.com', 'Team/App')).toBe(
      'github:github.com:team/app',
    );
  });
});

describe('center identity and pinned association', () => {
  const selection = {
    status: 'applied',
    tokenId: 't',
    provider: 'github',
    version: 'v1',
  };
  let service: PullRequestsService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    selection.version = 'v1';
    service = new PullRequestsService(
      {
        getRemotes: async () => [
          { name: 'origin', fetchUrl: 'https://github.com/team/app.git' },
        ],
      } as unknown as RepositoryService,
      {
        reconcile() {},
        selection: () => ({ ...selection }),
        credential: () => ({ token: 'secret', assertCurrent() {} }),
      } as unknown as AccessTokensService,
    );
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/user')
              ? { login: 'alice' }
              : [
                  {
                    number: 1,
                    title: 'Test',
                    state: 'open',
                    user: { login: 'bob' },
                    requested_reviewers: [{ login: 'alice' }],
                    updated_at: '2026-10-01T00:00:00Z',
                    head: { ref: 'feature' },
                    base: { ref: 'main' },
                  },
                ],
          ),
        ),
    );
  });
  afterEach(() => jest.restoreAllMocks());
  const q = {
    remote: 'origin',
    target: 'https://github.com/team/app',
    provider: 'github',
    state: 'open',
    page: 1,
    selectionVersion: 'v1',
  };
  it('reads the platform user, caches by association version and preserves direct reviewers', async () => {
    const a = await service.centerPage('repo', q);
    await service.centerPage('repo', q);
    expect(a.account?.username).toBe('alice');
    expect(a.items[0].reviewers).toEqual(['alice']);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/user')),
    ).toHaveLength(1);
    selection.version = 'v2';
    await service.centerPage('repo', { ...q, selectionVersion: 'v2' });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/user')),
    ).toHaveLength(2);
  });
  it('rejects a changed identity before reading or writing to the hosting service', async () => {
    selection.version = 'v2';
    await expect(service.centerPage('repo', q)).rejects.toThrow(
      '关联账号已变化',
    );
    await expect(service.detail('repo', { ...q, number: 1 })).rejects.toThrow(
      '关联账号已变化',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps the all view readable when identity permissions are unavailable', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/user')
        ? new Response('{}', { status: 403 })
        : new Response('[]'),
    );
    const result = await service.centerPage('repo', q);
    expect(result.account).toBeNull();
    expect(result.identityNotice).toContain('无法识别');
  });
});
