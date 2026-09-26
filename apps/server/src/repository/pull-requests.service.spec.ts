import {
  PullRequestsService,
  PULL_REQUEST_TIMEOUT_MS,
  validatePullRequestQuery,
} from './pull-requests.service';
import { pullRequestRemote } from './pull-request-remote';
import { RepositoryService } from './repository.service';

const remote = (
  fetchUrl = 'git@github.com:owner/repo.git',
  name = 'origin',
) => ({
  name,
  fetchUrl,
  pushUrl: 'git@gitlab.com:other/project.git',
});
const query = {
  remote: 'origin',
  target: 'https://github.com/owner/repo',
  provider: 'github' as const,
  state: 'open' as const,
  page: 1,
};
const github = (extra = {}) => ({
  number: 98,
  title: '支持 PR/MR',
  state: 'open',
  draft: true,
  user: { login: 'contributor' },
  head: { label: 'fork:feature' },
  base: { ref: 'main' },
  updated_at: '2026-09-26T08:00:00Z',
  html_url: 'javascript:alert(1)',
  ...extra,
});
const reply = (data: unknown, headers?: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(data), { status, headers });

describe('PR/MR remote identification', () => {
  it.each([
    ['git@github.com:owner/repo.git', 'github.com', 'owner/repo', 'github'],
    [
      'https://user:private-token@github.com/owner/repo.git',
      'github.com',
      'owner/repo',
      'github',
    ],
    [
      'ssh://git@gitlab.com:2222/group/sub/repo.git',
      'gitlab.com',
      'group/sub/repo',
      'gitlab',
    ],
    [
      'https://git.example.com:8443/group/sub/repo.git',
      'git.example.com:8443',
      'group/sub/repo',
      null,
    ],
    ['git@[2001:db8::1]:group/repo.git', '[2001:db8::1]', 'group/repo', null],
  ])(
    'parses %s without exposing credentials or confusing SSH ports',
    (url, host, project, provider) => {
      expect(pullRequestRemote(remote(url))).toEqual({
        name: 'origin',
        host,
        project,
        provider,
        webUrl: `https://${host}/${project}`,
      });
    },
  );

  it.each([
    '',
    '/local/repo',
    'C:/repo',
    'file:///repo',
    'http://gitlab.example.com/group/repo',
    'ftp://gitlab.com/g/r',
    'git@alias:group/repo.git',
    'https://github.com/only-owner',
    'https://github.com/group/sub/repo',
    'https://github.com/o/r?token=secret',
    'https://github.com/o/r#fragment',
    'https://gitlab.com/group//repo',
    'https://gitlab.com/a/b/../repo',
    'https://gitlab.com/g/%2e%2e/repo',
  ])('reports unsupported or ambiguous destinations: %s', (url) => {
    expect(pullRequestRemote(remote(url))).toMatchObject({
      webUrl: '',
      unavailableReason: expect.any(String),
    });
  });
});

describe('PullRequestsService', () => {
  let service: PullRequestsService;
  let remotes: jest.Mock;
  let request: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    remotes = jest.fn().mockResolvedValue([remote()]);
    service = new PullRequestsService({
      getRemotes: remotes,
    } as unknown as RepositoryService);
    request = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(reply([github()]));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('lists only sanitized remote descriptors without a hosting API call', async () => {
    remotes.mockResolvedValue([
      remote('https://user:secret@github.com/owner/repo.git'),
    ]);
    expect(JSON.stringify(await service.remotes('repo'))).not.toContain(
      'secret',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('reads public GitHub PRs and maps drafts, fork branches and a trusted external URL', async () => {
    request.mockImplementation(async () =>
      reply([github()], {
        link: '<https://untrusted.invalid/next>; rel="next"',
      }),
    );
    const result = await service.list('repo', query);
    expect(result).toEqual({
      page: 1,
      hasMore: true,
      items: [
        {
          number: 98,
          title: '支持 PR/MR',
          state: 'open',
          draft: true,
          author: 'contributor',
          sourceBranch: 'fork:feature',
          targetBranch: 'main',
          updatedAt: '2026-09-26T08:00:00Z',
          url: 'https://github.com/owner/repo/pull/98',
        },
      ],
    });
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe(
      'https://api.github.com/repos/owner/repo/pulls?state=open&per_page=30&page=1&sort=updated&direction=desc',
    );
    expect(options).toMatchObject({
      redirect: 'error',
      headers: { 'X-GitHub-Api-Version': '2022-11-28' },
    });
    expect(options?.headers).not.toHaveProperty('Authorization');
    // Treat pagination links as metadata, never follow their arbitrary URL.
    await service.list('repo', { ...query, page: 2 });
    expect(String(request.mock.calls[1][0])).toContain(
      'api.github.com/repos/owner/repo/pulls?',
    );
  });

  it('distinguishes merged, closed and open results while paging all states', async () => {
    request.mockResolvedValue(
      reply([
        github({ state: 'closed', merged_at: '2026-09-26T07:00:00Z' }),
        github({
          number: 97,
          state: 'closed',
          user: null,
          head: null,
          draft: false,
        }),
      ]),
    );
    const result = await service.list('repo', {
      ...query,
      state: 'all',
      token: 'temporary-token',
    });
    expect(result.items.map((item) => item.state)).toEqual([
      'merged',
      'closed',
    ]);
    expect(result.items[1]).toMatchObject({
      author: '已删除的用户',
      sourceBranch: '',
    });
    expect(String(request.mock.calls[0][0])).toContain('state=all');
    expect(request.mock.calls[0][1]?.headers).toHaveProperty(
      'Authorization',
      'Bearer temporary-token',
    );
    expect(String(request.mock.calls[0][0])).not.toContain('temporary-token');
  });

  it('supports nested projects and HTTPS ports on an explicitly selected self-hosted GitLab', async () => {
    remotes.mockResolvedValue([
      remote('https://git.example.com:8443/team/sub/project.git', 'upstream'),
    ]);
    request.mockResolvedValue(
      reply(
        [
          {
            iid: 12,
            title: 'MR',
            state: 'merged',
            work_in_progress: true,
            author: { username: 'alice' },
            source_branch: 'feature',
            target_branch: 'main',
            updated_at: '2026-09-26T08:00:00Z',
          },
        ],
        { 'x-next-page': '3' },
      ),
    );
    const result = await service.list('repo', {
      ...query,
      remote: 'upstream',
      target: 'https://git.example.com:8443/team/sub/project',
      provider: 'gitlab',
      page: 2,
      token: 'gitlab-secret',
    });
    expect(result).toMatchObject({
      page: 2,
      hasMore: true,
      items: [
        {
          state: 'merged',
          draft: true,
          author: 'alice',
          url: 'https://git.example.com:8443/team/sub/project/-/merge_requests/12',
        },
      ],
    });
    expect(String(request.mock.calls[0][0])).toBe(
      'https://git.example.com:8443/api/v4/projects/team%2Fsub%2Fproject/merge_requests?state=opened&per_page=30&page=2&scope=all&order_by=updated_at&sort=desc',
    );
    expect(request.mock.calls[0][1]?.headers).toHaveProperty(
      'PRIVATE-TOKEN',
      'gitlab-secret',
    );
  });

  it('returns a real empty page and does not retain a token for subsequent calls', async () => {
    request.mockImplementation(async () => reply([]));
    await service.list('repo', { ...query, token: 'secret' });
    expect(await service.list('repo', query)).toEqual({
      items: [],
      page: 1,
      hasMore: false,
    });
    expect(request.mock.calls[1][1]?.headers).not.toHaveProperty(
      'Authorization',
    );
  });

  it('refuses removed, changed or mismatched remotes before sending credentials', async () => {
    for (const [input, status] of [
      [{ ...query, remote: 'deleted' }, 404],
      [{ ...query, target: 'https://github.com/other/repo' }, 409],
      [{ ...query, provider: 'gitlab' }, 400],
    ] as const) {
      await expect(
        service.list('repo', { ...input, token: 'secret' }),
      ).rejects.toMatchObject({ status });
    }
    remotes.mockResolvedValue([remote('git@other.example.com:owner/repo.git')]);
    await expect(
      service.list('repo', {
        ...query,
        target: 'https://other.example.com/owner/repo',
        token: 'secret',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [401, {}, 401, '认证失败'],
    [403, {}, 403, '没有访问权限'],
    [404, {}, 404, '仓库不存在'],
    [429, {}, 429, '请求次数'],
    [403, { 'x-ratelimit-remaining': '0' }, 429, '请求次数'],
    [403, { 'retry-after': '60' }, 429, '请求次数'],
    [503, {}, 502, '暂时不可用'],
  ])(
    'maps HTTP %s to actionable, sanitized failures',
    async (status, headers, expectedStatus, message) => {
      request.mockResolvedValue(
        reply({ error: 'never-echo-secret' }, headers, status),
      );
      await expect(service.list('repo', query)).rejects.toMatchObject({
        status: expectedStatus,
        message: expect.stringContaining(message),
      });
    },
  );

  it('rejects redirects, malformed responses and oversized bodies without exposing upstream errors', async () => {
    request.mockRejectedValueOnce(
      new Error('redirect from https://secret@host'),
    );
    await expect(service.list('repo', query)).rejects.toMatchObject({
      status: 502,
      message: expect.not.stringContaining('secret'),
    });
    for (const payload of [
      { message: 'not a list' },
      [github({ number: -1 })],
      [github({ updated_at: 'bad' })],
      [github({ state: 'unknown' })],
    ]) {
      request.mockResolvedValueOnce(reply(payload));
      await expect(service.list('repo', query)).rejects.toMatchObject({
        status: 502,
      });
    }
    request.mockResolvedValueOnce(new Response('not json'));
    await expect(service.list('repo', query)).rejects.toMatchObject({
      status: 502,
    });
    request.mockResolvedValueOnce(
      new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(service.list('repo', query)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('过大'),
    });
  });

  it('times out SSH discovery and never issues a hosting request after the deadline', async () => {
    jest.useFakeTimers();
    let resolve!: (value: any) => void;
    remotes.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const failure = expect(service.list('repo', query)).rejects.toMatchObject({
      status: 504,
    });
    await jest.advanceTimersByTimeAsync(PULL_REQUEST_TIMEOUT_MS);
    await failure;
    expect(remotes.mock.calls[0][1].aborted).toBe(true);
    resolve([remote()]);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it('cancels slow API requests and sanitizes SSH failures', async () => {
    jest.useFakeTimers();
    request.mockImplementation(
      (_url, options) =>
        new Promise((_, reject) => {
          options!.signal!.addEventListener('abort', () =>
            reject(options!.signal!.reason),
          );
        }),
    );
    const failure = expect(service.list('repo', query)).rejects.toMatchObject({
      status: 504,
    });
    await jest.advanceTimersByTimeAsync(PULL_REQUEST_TIMEOUT_MS);
    await failure;
    remotes.mockRejectedValue(new Error('remote https://password@host failed'));
    await expect(service.remotes('repo')).rejects.toMatchObject({
      status: 502,
      message: expect.not.stringContaining('password'),
    });
  });

  it.each([
    null,
    [],
    {},
    { ...query, page: '1' },
    { ...query, page: 0 },
    { ...query, page: 1.5 },
    { ...query, page: 10001 },
    { ...query, state: 'bogus' },
    { ...query, token: 'a\nb' },
    { ...query, token: 42 },
    { ...query, remote: ['origin'] },
    { ...query, provider: 'unknown' },
  ])(
    'validates untrusted API input before any SSH or hosting request',
    (value) => {
      expect(() => validatePullRequestQuery(value)).toThrow();
      expect(() => service.list('repo', value)).toThrow();
      expect(remotes).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );
});
