import { randomUUID } from 'node:crypto';
import {
  PullRequestCreationService,
  validateCreate,
} from './pull-request-creation.service';
import { PullRequestsService } from './pull-requests.service';
import type { RepositoryService } from './repository.service';
import type { AccessTokensService } from '../access-tokens/access-tokens.service';

const base = 'b'.repeat(40),
  head = 'a'.repeat(40);
const query = {
  remote: 'origin',
  target: 'https://github.com/team/repo',
  provider: 'github' as const,
  token: 'private-secret',
};

describe('PR/MR creation platform contract', () => {
  let service: PullRequestCreationService;
  let request: jest.SpiedFunction<typeof fetch>;
  let remotes: jest.Mock;
  let local: jest.Mock;
  let published: boolean;
  let existing: boolean;
  let currentBase: string;
  let writeStatus: number;
  let optionsFail: boolean;
  let responseLost: boolean;
  let template: boolean;
  let created: any[];
  let calls: { url: URL; body: any; method: string }[];
  beforeEach(() => {
    published = true;
    existing = false;
    currentBase = base;
    writeStatus = 200;
    optionsFail = false;
    responseLost = false;
    template = true;
    created = [];
    calls = [];
    remotes = jest.fn().mockResolvedValue([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/team/repo.git',
        pushUrl: 'https://github.com/team/repo.git',
      },
    ]);
    local = jest.fn().mockResolvedValue({ name: 'feature/test', sha: head });
    const repos = {
      getRemotes: remotes,
      pullRequestBranch: local,
    } as unknown as RepositoryService;
    const tokens = {
      reconcile() {},
      selection() {},
      credential: () => ({ token: '', assertCurrent() {} }),
    } as unknown as AccessTokensService;
    service = new PullRequestCreationService(
      repos,
      new PullRequestsService(repos, tokens),
    );
    request = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        const url = new URL(String(input));
        const body = options?.body ? JSON.parse(String(options.body)) : null;
        const method = options?.method || 'GET';
        calls.push({ url, body, method });
        const github = url.host === 'api.github.com';
        const json = (value: unknown, status = 200) =>
          new Response(JSON.stringify(value), { status });
        if (method !== 'GET') {
          if (writeStatus !== 200)
            return json({ message: 'private-secret' }, writeStatus);
          if (
            url.pathname.endsWith('/pulls') ||
            url.pathname.endsWith('/merge_requests')
          ) {
            created.push(body);
            if (responseLost) throw new Error('private-secret socket lost');
            return json({
              number: 17,
              iid: 17,
              title: body.title,
              state: github ? 'open' : 'opened',
              draft: body.draft,
              work_in_progress: body.title.startsWith('Draft:'),
              updated_at: '2026-10-05T00:00:00Z',
              head: { ref: body.head },
              base: { ref: body.base },
              source_branch: body.source_branch,
              target_branch: body.target_branch,
            });
          }
          return json({}, optionsFail ? 403 : 200);
        }
        if (/\/branches\//.test(url.pathname)) {
          const name = decodeURIComponent(url.pathname.split('/branches/')[1]);
          return name === 'feature/test' && !published
            ? json({}, 404)
            : json({
                commit: {
                  sha: name === 'main' ? currentBase : head,
                  id: name === 'main' ? currentBase : head,
                },
              });
        }
        if (url.pathname.endsWith('/branches'))
          return json([{ name: 'main' }, { name: 'feature/test' }]);
        if (url.pathname.includes('/compare'))
          return json({
            commits: [
              {
                sha: head,
                id: head,
                commit: { message: 'feat: 新增入口' },
                message: 'feat: 新增入口',
              },
            ],
            files: [
              {
                filename: 'entry.ts',
                status: 'added',
                additions: 1,
                deletions: 0,
                patch: '@@ -0,0 +1 @@\n+entry();',
              },
            ],
            diffs: [
              {
                new_path: 'entry.ts',
                new_file: true,
                diff: '@@ -0,0 +1 @@\n+entry();',
              },
            ],
          });
        if (/\/(pulls|merge_requests)$/.test(url.pathname))
          return json(
            existing
              ? [
                  {
                    number: 8,
                    iid: 8,
                    title: 'Existing',
                    state: github ? 'open' : 'opened',
                    updated_at: '2026-10-05T00:00:00Z',
                  },
                ]
              : [],
          );
        if (
          url.pathname.includes('/contents/') ||
          url.pathname.includes('/repository/files/')
        )
          return template
            ? json({
                encoding: 'base64',
                content: Buffer.from('## 改动\n\n## 验证').toString('base64'),
              })
            : json({}, 404);
        if (/\/(assignees|collaborators|members\/all)$/.test(url.pathname))
          return json([
            { login: 'alice', username: 'alice', name: 'Alice', id: 7 },
          ]);
        if (url.pathname.endsWith('/labels'))
          return json([{ name: 'enhancement' }]);
        return json({ default_branch: 'main' });
      });
  });
  afterEach(() => request.mockRestore());
  const form = (preview: any, extra = {}) => ({
    ...query,
    sourceBranch: preview.sourceBranch,
    targetBranch: preview.targetBranch,
    revision: preview.revision,
    operationId: randomUUID(),
    title: 'feat: 创建 PR',
    description: '## 改动\n新增入口',
    draft: false,
    ...extra,
  });

  it('compares immutable merge-base refs, uses the default branch, and reads a template from the target revision', async () => {
    const preview = await service.preview('repo', query);
    expect(preview).toMatchObject({
      sourceBranch: 'feature/test',
      targetBranch: 'main',
      pushRequired: false,
      template: '## 改动\n\n## 验证',
      files: [{ path: 'entry.ts' }],
    });
    expect(
      calls.find((c) => c.url.pathname.includes('/compare/'))!.url.pathname,
    ).toContain(`${base}...${head}`);
    expect(
      calls
        .find((c) => c.url.pathname.includes('/contents/'))!
        .url.searchParams.get('ref'),
    ).toBe(base);
    expect(preview.options.reviewers).toEqual([
      { value: 'alice', label: 'alice' },
    ]);
  });
  it.each([false, true])(
    'creates a GitHub request (draft=%s) and coalesces duplicate submissions',
    async (draft) => {
      const input = form(await service.preview('repo', query), {
        draft,
        assignees: ['alice'],
        reviewers: ['alice'],
        labels: ['enhancement'],
      });
      const [one, two] = await Promise.all([
        service.create('repo', input),
        service.create('repo', input),
      ]);
      expect(one).toEqual(two);
      expect(one.item.url).toBe('https://github.com/team/repo/pull/17');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        head: 'feature/test',
        base: 'main',
        draft,
      });
      expect(
        calls.find((c) => c.url.pathname.endsWith('/requested_reviewers'))
          ?.body,
      ).toEqual({ reviewers: ['alice'] });
    },
  );
  it.each([false, true])(
    'creates a self-hosted HTTPS GitLab MR (draft=%s) with platform IDs',
    async (draft) => {
      const gitlab = {
        ...query,
        provider: 'gitlab' as const,
        target: 'https://git.example.com:8443/team/sub/repo',
      };
      remotes.mockResolvedValue([
        {
          name: 'origin',
          fetchUrl: `${gitlab.target}.git`,
          pushUrl: `${gitlab.target}.git`,
        },
      ]);
      const preview = await service.preview('repo', gitlab);
      const result = await service.create(
        'repo',
        form(preview, {
          ...gitlab,
          draft,
          assignees: ['7'],
          reviewers: ['7'],
          labels: ['enhancement'],
        }),
      );
      expect(created[0]).toMatchObject({
        title: draft ? 'Draft: feat: 创建 PR' : 'feat: 创建 PR',
        source_branch: 'feature/test',
        target_branch: 'main',
        assignee_ids: [7],
        reviewer_ids: [7],
        labels: 'enhancement',
      });
      expect(result.item.url).toBe(`${gitlab.target}/-/merge_requests/17`);
      expect(
        calls
          .find((c) => c.url.pathname.endsWith('/repository/compare'))
          ?.url.searchParams.get('straight'),
      ).toBe('false');
    },
  );
  it('blocks unpublished or locally changed branches, then allows a refreshed preview', async () => {
    published = false;
    const preview = await service.preview('repo', query);
    expect(preview.pushRequired).toBe(true);
    await expect(service.create('repo', form(preview))).rejects.toThrow(
      '尚未完整推送',
    );
    published = true;
    local.mockResolvedValue({ name: 'feature/test', sha: 'c'.repeat(40) });
    expect((await service.preview('repo', query)).pushRequired).toBe(true);
    expect(created).toHaveLength(0);
  });
  it('rejects stale previews and existing same-branch requests before writing', async () => {
    const input = form(await service.preview('repo', query));
    currentBase = 'c'.repeat(40);
    await expect(service.create('repo', input)).rejects.toThrow('分支已变化');
    existing = true;
    await expect(service.create('repo', input)).rejects.toThrow('已存在');
    expect(created).toHaveLength(0);
  });
  it('keeps successful creation when optional metadata fails', async () => {
    optionsFail = true;
    const result = await service.create(
      'repo',
      form(await service.preview('repo', query), { reviewers: ['alice'] }),
    );
    expect(result.item.number).toBe(17);
    expect(result.warning).toContain('PR 已创建');
    expect(created).toHaveLength(1);
  });
  it('reports permissions without reflecting secrets and permits a corrected retry', async () => {
    const input = form(await service.preview('repo', query));
    writeStatus = 403;
    await expect(service.create('repo', input)).rejects.toThrow('没有写入权限');
    writeStatus = 200;
    expect((await service.create('repo', input)).item.number).toBe(17);
  });
  it('does not dispatch a second create after a lost response', async () => {
    const input = form(await service.preview('repo', query));
    responseLost = true;
    await expect(service.create('repo', input)).rejects.toThrow(
      '核对是否已创建',
    );
    await expect(service.create('repo', input)).rejects.toThrow(
      '核对是否已创建',
    );
    expect(created).toHaveLength(1);
  });
  it('manual creation works without a template and anonymous writes are rejected', async () => {
    template = false;
    const preview = await service.preview('repo', query);
    expect(preview.template).toBe('');
    await expect(
      service.create('repo', form(preview, { token: '' })),
    ).rejects.toThrow('写入权限');
    expect(created).toHaveLength(0);
  });
  it('does not guide a push to a different project', async () => {
    published = false;
    remotes.mockResolvedValue([
      {
        name: 'origin',
        fetchUrl: `${query.target}.git`,
        pushUrl: 'https://github.com/other/repo.git',
      },
    ]);
    const preview = await service.preview('repo', query);
    expect(preview.pushBlockedReason).toContain('推送地址');
    await expect(service.create('repo', form(preview))).rejects.toThrow(
      '跨仓库',
    );
  });
  it('validates untrusted forms', () => {
    for (const extra of [
      { title: '' },
      { targetBranch: 'main..evil' },
      { title: 'title\nbody' },
      { assignees: ['7,8'] },
      { draft: 'true' },
      { provider: 'gitlab', reviewers: ['alice'] },
    ])
      expect(() =>
        validateCreate(
          form(
            {
              sourceBranch: 'feature',
              targetBranch: 'main',
              revision: 'f'.repeat(64),
            },
            extra,
          ),
        ),
      ).toThrow();
  });
});
