import { ConflictException } from '@nestjs/common';
import { PullRequestsService } from './pull-requests.service';
import { RepositoryService } from './repository.service';
import { AccessTokensService } from '../access-tokens/access-tokens.service';
import { normalizeDiscussion, normalizeFile } from './pull-request-content';

const query = {
  remote: 'origin',
  target: 'https://github.com/team/repo',
  provider: 'github',
  number: 12,
};
const pageQuery = { ...query, page: 1 };
const detail = {
  number: 12,
  title: 'Review me',
  state: 'closed',
  merged_at: '2026-09-29T00:00:00Z',
  body: '## Description',
  user: { login: 'alice' },
  head: { label: 'fork:feature' },
  base: { ref: 'main' },
  updated_at: '2026-09-29T00:00:00Z',
  changed_files: 2,
};
const patch = '@@ -3,2 +3,2 @@\n context\n-old\n+new';
const response = (data: unknown, headers = {}, status = 200) =>
  new Response(JSON.stringify(data), { headers, status });

describe('PR/MR details, changes and discussions', () => {
  let service: PullRequestsService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let getRemotes: jest.Mock;
  let assertCurrent: jest.Mock;
  beforeEach(() => {
    getRemotes = jest
      .fn()
      .mockResolvedValue([
        { name: 'origin', fetchUrl: 'git@github.com:team/repo.git' },
      ]);
    assertCurrent = jest.fn();
    service = new PullRequestsService(
      { getRemotes } as unknown as RepositoryService,
      {
        reconcile() {},
        selection() {},
        credential: () => ({ token: 'saved-secret', assertCurrent }),
      } as unknown as AccessTokensService,
    );
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads merged GitHub details with the existing credential and safe destination', async () => {
    fetchMock.mockResolvedValue(
      response({ ...detail, html_url: 'javascript:alert(1)' }),
    );
    expect(await service.detail('repo', query)).toMatchObject({
      number: 12,
      description: '## Description',
      state: 'merged',
      sourceBranch: 'fork:feature',
      fileCount: 2,
      url: 'https://github.com/team/repo/pull/12',
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.github.com/repos/team/repo/pulls/12',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer saved-secret' },
    });
    expect(assertCurrent).toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ ...detail, changed_files: 4000 }));
    expect((await service.detail('repo', query)).filesNotice).toContain('3000');
    fetchMock.mockResolvedValue(response({ ...detail, number: 13 }));
    await expect(service.detail('repo', query)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('pages files without following untrusted pagination links and honors explicit anonymous access', async () => {
    fetchMock.mockImplementation(async () =>
      response(
        [
          {
            filename: 'src/a.ts',
            status: 'renamed',
            previous_filename: 'src/b.ts',
            additions: 1,
            deletions: 1,
            patch,
          },
        ],
        { link: '<https://elsewhere.invalid>; rel="next"' },
      ),
    );
    expect(
      await service.files('repo', { ...pageQuery, page: 2, token: '' }),
    ).toMatchObject({
      page: 2,
      hasMore: true,
      items: [
        {
          path: 'src/a.ts',
          previousPath: 'src/b.ts',
          status: 'renamed',
          patch,
        },
      ],
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.github.com/repos/team/repo/pulls/12/files?per_page=30&page=2',
    );
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty(
      'Authorization',
    );
    expect(
      (await service.files('repo', { ...pageQuery, page: 100 })).hasMore,
    ).toBe(false);
    expect(
      await service.files('repo', { ...pageQuery, page: 101 }),
    ).toMatchObject({
      items: [],
      hasMore: false,
      notice: expect.stringContaining('3000'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads all GitHub discussion sources, including replies and outdated code context on later pages', async () => {
    const note = {
      id: 9,
      body: 'Please update this',
      user: { login: 'bob' },
      created_at: '2026-09-29T00:00:00Z',
    };
    fetchMock.mockResolvedValue(response([note]));
    await service.discussions('repo', { ...pageQuery, kind: 'comments' });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/issues/12/comments?',
    );
    fetchMock.mockResolvedValue(
      response([
        { ...note, body: '', state: 'APPROVED', submitted_at: note.created_at },
      ]),
    );
    expect(
      (await service.discussions('repo', { ...pageQuery, kind: 'reviews' }))
        .items[0].comments[0],
    ).toMatchObject({ reviewState: 'APPROVED', body: '' });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/pulls/12/reviews?');
    fetchMock.mockResolvedValue(
      response([
        {
          ...note,
          id: 10,
          in_reply_to_id: 9,
          path: 'src/a.ts',
          side: 'LEFT',
          line: null,
          original_line: 4,
          diff_hunk: patch,
        },
      ]),
    );
    expect(
      (
        await service.discussions('repo', {
          ...pageQuery,
          kind: 'code',
          page: 2,
        })
      ).items[0],
    ).toMatchObject({
      id: 'code:9',
      comments: [
        {
          replyTo: '9',
          context: { path: 'src/a.ts', oldLine: 4, outdated: true, patch },
        },
      ],
    });
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      '/pulls/12/comments?per_page=30&page=2',
    );
  });

  const gitlab = {
    ...pageQuery,
    provider: 'gitlab',
    target: 'https://git.example.com:8443/team/sub/repo',
  };
  function gitlabRemote(mock: jest.Mock) {
    mock.mockResolvedValue([
      { name: 'origin', fetchUrl: `${gitlab.target}.git` },
    ]);
  }

  it('reads self-hosted GitLab details, paginated diffs and discussion replies with file/line context', async () => {
    gitlabRemote(getRemotes);
    fetchMock.mockResolvedValue(
      response({
        iid: 12,
        title: 'MR',
        state: 'opened',
        updated_at: detail.updated_at,
        description: 'GitLab body',
        source_branch: 'feature',
        target_branch: 'main',
        changes_count: '1000+',
      }),
    );
    expect(await service.detail('repo', gitlab)).toMatchObject({
      description: 'GitLab body',
      state: 'open',
      fileCount: null,
      filesNotice: expect.stringContaining('省略'),
    });
    fetchMock.mockResolvedValue(
      response(
        [
          {
            new_path: 'new.ts',
            old_path: 'old.ts',
            renamed_file: true,
            diff: patch,
          },
        ],
        { 'x-next-page': '3' },
      ),
    );
    expect(await service.files('repo', { ...gitlab, page: 2 })).toMatchObject({
      page: 2,
      hasMore: true,
      items: [{ status: 'renamed', additions: 1, deletions: 1 }],
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://git.example.com:8443/api/v4/projects/team%2Fsub%2Frepo/merge_requests/12/diffs?per_page=30&page=2',
    );
    expect(fetchMock.mock.calls[1][1]?.headers).toHaveProperty(
      'PRIVATE-TOKEN',
      'saved-secret',
    );
    const note = {
      id: 1,
      body: 'Line note',
      author: { username: 'alice' },
      created_at: detail.updated_at,
      resolvable: true,
      resolved: true,
      position: {
        new_path: 'new.ts',
        old_path: 'old.ts',
        new_line: 4,
        old_line: null,
      },
    };
    fetchMock.mockResolvedValue(
      response([
        { id: 'thread', notes: [note, { ...note, id: 2, body: 'Reply' }] },
      ]),
    );
    expect(
      (await service.discussions('repo', { ...gitlab, kind: 'comments' }))
        .items[0],
    ).toMatchObject({
      id: 'thread',
      resolved: true,
      comments: [
        {
          body: 'Line note',
          context: { path: 'new.ts', oldPath: 'old.ts', newLine: 4 },
        },
        { body: 'Reply' },
      ],
    });
  });

  it('falls back for older GitLab versions and labels provider-truncated changes', async () => {
    gitlabRemote(getRemotes);
    fetchMock
      .mockResolvedValueOnce(response({}, {}, 404))
      .mockResolvedValueOnce(
        response({
          overflow: true,
          changes: Array.from({ length: 31 }, (_, i) => ({
            new_path: `${i}.ts`,
            diff: patch,
          })),
        }),
      );
    const result = await service.files('repo', { ...gitlab, page: 2 });
    expect(result).toMatchObject({
      items: [{ path: '30.ts' }],
      hasMore: false,
      notice: expect.stringContaining('截断'),
    });
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/changes$/);
  });

  it.each(['detail', 'files', 'discussions'] as const)(
    'protects %s from changed remotes, stale credentials and forbidden requests',
    async (method) => {
      const input = { ...pageQuery, kind: 'comments' };
      await expect(
        service[method]('repo', {
          ...input,
          target: 'https://github.com/other/repo',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockImplementation(async () => {
        assertCurrent.mockImplementation(() => {
          throw new ConflictException('令牌已变化');
        });
        return response(detail);
      });
      await expect(service[method]('repo', input)).rejects.toMatchObject({
        status: 409,
      });
      assertCurrent.mockReset();
      fetchMock.mockResolvedValue(
        response({ message: 'private secret' }, {}, 403),
      );
      await expect(service[method]('repo', input)).rejects.toMatchObject({
        status: 403,
        message: expect.not.stringContaining('secret'),
      });
    },
  );

  it('rejects invalid numbers, pages, kinds and malformed responses', async () => {
    for (const number of [0, -1, 1.2, '12', undefined])
      expect(() => service.detail('repo', { ...query, number })).toThrow();
    for (const page of [0, 1.2, '2', 10001])
      expect(() => service.files('repo', { ...pageQuery, page })).toThrow();
    expect(() =>
      service.discussions('repo', { ...pageQuery, kind: 'unknown' }),
    ).toThrow();
    expect(() =>
      service.discussions('repo', { ...gitlab, kind: 'reviews' }),
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response([{ filename: null }]));
    await expect(service.files('repo', pageQuery)).rejects.toMatchObject({
      status: 502,
    });
    fetchMock.mockResolvedValue(response({ not: 'a page' }));
    await expect(
      service.discussions('repo', { ...pageQuery, kind: 'comments' }),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe('hosting patch completeness', () => {
  it('distinguishes complete text, incomplete hunks, missing/binary patches and large files', () => {
    const file = {
      filename: 'a.ts',
      patch,
      additions: 1,
      deletions: 1,
      status: 'modified',
    };
    expect(normalizeFile(file, 'github').notice).toBeUndefined();
    expect(
      normalizeFile(
        {
          ...file,
          status: 'added',
          patch: '@@ -0,0 +1 @@\n+new',
          additions: 1,
          deletions: 0,
        },
        'github',
      ),
    ).toMatchObject({ status: 'added', notice: undefined });
    expect(
      normalizeFile(
        {
          new_path: 'removed.ts',
          deleted_file: true,
          diff: '@@ -1 +0,0 @@\n-old',
        },
        'gitlab',
      ),
    ).toMatchObject({
      status: 'deleted',
      additions: 0,
      deletions: 1,
      notice: undefined,
    });
    expect(
      normalizeDiscussion(
        { id: 1, path: 'a.ts', diff_hunk: 'x'.repeat(200001) },
        'github',
        'code',
      ).comments[0].context,
    ).toMatchObject({
      path: 'a.ts',
      patch: undefined,
      notice: expect.stringContaining('过大'),
    });
    expect(normalizeFile({ ...file, additions: 2 }, 'github').notice).toContain(
      '不完整',
    );
    expect(
      normalizeFile(
        { ...file, patch: '@@ -3,10 +3,10 @@\n context\n-old\n+new' },
        'github',
      ).notice,
    ).toContain('不完整');
    expect(normalizeFile({ ...file, patch: null }, 'github')).toMatchObject({
      patch: null,
      notice: expect.stringContaining('未提供'),
    });
    expect(
      normalizeFile(
        { ...file, patch: 'Binary files a and b differ' },
        'github',
      ),
    ).toMatchObject({ patch: null, notice: expect.stringContaining('二进制') });
    expect(
      normalizeFile({ new_path: 'a.ts', too_large: true, diff: '' }, 'gitlab'),
    ).toMatchObject({ patch: null, notice: expect.stringContaining('过大') });
    expect(
      normalizeFile({ new_path: 'a.ts', collapsed: true, diff: '' }, 'gitlab')
        .notice,
    ).toContain('折叠');
    expect(
      normalizeFile({ ...file, patch: 'x'.repeat(200001) }, 'github').patch,
    ).toBeNull();
    expect(
      normalizeFile(
        {
          ...file,
          patch: '@@ -1 +1 @@\n--- old\n+++ new\n\\ No newline at end of file',
        },
        'github',
      ).notice,
    ).toBeUndefined();
  });
});
