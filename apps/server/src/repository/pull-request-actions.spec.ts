import { randomUUID, createHash } from 'node:crypto';
import { PullRequestsService } from './pull-requests.service';
import { RepositoryService } from './repository.service';
import { AccessTokensService } from '../access-tokens/access-tokens.service';
import {
  codeCommentPayload,
  requestActions,
  requestRevision,
} from './pull-request-actions';
import { normalizeDiscussion } from './pull-request-content';
import { pullRequestRange } from '@alune/shared';
import type { PullRequestMutation } from '@alune/shared';

const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  start = 'c'.repeat(40);
const patch =
  '@@ -10,3 +10,4 @@\n context\n-old\n-older\n+new\n+newer\n+newest';
const github = {
  number: 12,
  title: 'Review',
  state: 'open',
  user: { login: 'alice' },
  head: { sha: head, ref: 'feature' },
  base: { sha: base, ref: 'main' },
  updated_at: '2026-09-30T00:00:00Z',
  mergeable: true,
  mergeable_state: 'clean',
};
const gitlab = {
  iid: 12,
  title: 'Review',
  state: 'opened',
  author: { id: 7, username: 'alice' },
  source_branch: 'feature',
  target_branch: 'main',
  diff_refs: { head_sha: head, base_sha: base, start_sha: start },
  updated_at: github.updated_at,
  detailed_merge_status: 'mergeable',
  user: { can_merge: true },
};
const ghProject = {
  permissions: { push: true },
  allow_merge_commit: true,
  allow_squash_merge: true,
  allow_rebase_merge: false,
};
const glProject = {
  permissions: { project_access: { access_level: 40 } },
  merge_method: 'ff',
  squash_option: 'default_on',
};
const query = {
  remote: 'origin',
  target: 'https://github.com/team/repo',
  provider: 'github' as const,
  number: 12,
};
const glQuery = {
  ...query,
  provider: 'gitlab' as const,
  target: 'https://git.example.com:8443/team/sub/repo',
};
const file = {
  path: 'new.ts',
  previousPath: 'old.ts',
  patch,
  status: 'renamed' as const,
  additions: 3,
  deletions: 2,
};
const position = {
  path: file.path,
  side: 'RIGHT' as const,
  startLine: 11,
  endLine: 13,
  filePage: 1,
};
const mutation = (
  extra: Partial<PullRequestMutation> = {},
): PullRequestMutation => ({
  ...query,
  operationId: randomUUID(),
  revision: requestRevision(github, 'github'),
  action: 'comment',
  body: 'Review comment',
  ...extra,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

describe('review locations and capability constraints', () => {
  it('accepts consecutive added/deleted lines but rejects mixed sides, gaps and hunk boundaries', () => {
    expect(pullRequestRange(patch, position)).toHaveLength(3);
    expect(
      pullRequestRange(patch, { side: 'LEFT', startLine: 11, endLine: 12 }),
    ).toHaveLength(2);
    expect(
      pullRequestRange(patch, { side: 'RIGHT', startLine: 10, endLine: 11 }),
    ).toBeNull();
    expect(
      pullRequestRange(patch + '\n@@ -14 +14 @@\n next', {
        side: 'RIGHT',
        startLine: 13,
        endLine: 14,
      }),
    ).toBeNull();
    expect(
      pullRequestRange(patch, { side: 'RIGHT', startLine: 11, endLine: 14 }),
    ).toBeNull();
  });

  it('uses GitHub commit/side/range and omits range fields for single lines', () => {
    expect(codeCommentPayload(mutation({ position }), github, file)).toEqual({
      body: 'Review comment',
      commit_id: head,
      path: 'new.ts',
      side: 'RIGHT',
      line: 13,
      start_side: 'RIGHT',
      start_line: 11,
    });
    expect(
      codeCommentPayload(
        mutation({
          position: { ...position, side: 'LEFT', startLine: 11, endLine: 11 },
        }),
        github,
        file,
      ),
    ).toEqual({
      body: 'Review comment',
      commit_id: head,
      path: 'new.ts',
      side: 'LEFT',
      line: 11,
    });
  });

  it('uses GitLab current path hash and both cursors for renamed added/deleted ranges', () => {
    const hash = createHash('sha1').update('new.ts').digest('hex');
    expect(
      codeCommentPayload(mutation({ ...glQuery, position }), gitlab, file),
    ).toEqual({
      body: 'Review comment',
      position: {
        position_type: 'text',
        ...gitlab.diff_refs,
        old_path: 'old.ts',
        new_path: 'new.ts',
        new_line: 13,
        line_range: {
          start: { line_code: `${hash}_13_11`, type: 'new', new_line: 11 },
          end: { line_code: `${hash}_13_13`, type: 'new', new_line: 13 },
        },
      },
    });
    const deleted = codeCommentPayload(
      mutation({
        ...glQuery,
        position: { ...position, side: 'LEFT', startLine: 11, endLine: 12 },
      }),
      gitlab,
      file,
    ) as any;
    expect(deleted.position.line_range.end).toEqual({
      line_code: `${hash}_12_11`,
      type: 'old',
      old_line: 12,
    });
    const context = codeCommentPayload(
      mutation({
        ...glQuery,
        position: { ...position, startLine: 10, endLine: 10 },
      }),
      gitlab,
      file,
    ) as any;
    expect(context.position).toMatchObject({ old_line: 10, new_line: 10 });
  });

  it('reads the correct old-side start line from GitLab multiline discussions', () => {
    const result = normalizeDiscussion(
      {
        id: 'thread',
        notes: [
          {
            id: 1,
            body: 'note',
            position: {
              new_path: 'new.ts',
              old_line: 12,
              line_range: {
                start: { type: 'old', old_line: 10, new_line: 15 },
              },
            },
          },
        ],
      },
      'gitlab',
      'comments',
    );
    expect(result.comments[0].context).toMatchObject({
      startLine: 10,
      startSide: 'LEFT',
      oldLine: 12,
    });
  });

  it.each(['closed', 'merged'])(
    'disables state changes but permits discussion on %s requests',
    (state) => {
      const result = requestActions(
        { ...gitlab, state },
        glProject,
        { id: 7 },
        'gitlab',
        true,
      );
      expect(result.comment.allowed).toBe(true);
      expect(result.close.allowed).toBe(false);
      expect(result.merge.allowed).toBe(false);
    },
  );

  it('checks author close access, locked discussions, authentication and enabled merge methods', () => {
    const author = requestActions(
      github,
      { ...ghProject, permissions: {} },
      { login: 'alice' },
      'github',
      true,
    );
    expect(author.close.allowed).toBe(true);
    expect(author.merge.allowed).toBe(false);
    expect(
      requestActions(github, ghProject, {}, 'github', false).comment.allowed,
    ).toBe(false);
    expect(
      requestActions(
        { ...github, locked: true },
        {},
        { login: 'bob' },
        'github',
        true,
      ).comment.allowed,
    ).toBe(false);
    expect(
      requestActions(github, ghProject, {}, 'github', true).mergeMethods.map(
        (m) => m.value,
      ),
    ).toEqual(['merge', 'squash']);
    expect(
      requestActions(
        gitlab,
        { ...glProject, squash_option: 'always' },
        {},
        'gitlab',
        true,
      ).mergeMethods.map((m) => m.value),
    ).toEqual(['squash']);
  });

  it.each(['dirty', 'blocked', 'behind', 'unknown'])(
    'blocks GitHub merge state %s',
    (mergeable_state) => {
      expect(
        requestActions(
          { ...github, mergeable_state },
          ghProject,
          {},
          'github',
          true,
        ).merge.allowed,
      ).toBe(false);
    },
  );
  it.each([
    'conflict',
    'ci_must_pass',
    'ci_still_running',
    'not_approved',
    'discussions_not_resolved',
    'checking',
    undefined,
  ])('blocks GitLab status %s', (detailed_merge_status) => {
    expect(
      requestActions(
        { ...gitlab, detailed_merge_status },
        glProject,
        {},
        'gitlab',
        true,
      ).merge.allowed,
    ).toBe(false);
  });

  describe('legacy GitLab merge status', () => {
    const { detailed_merge_status: _, ...legacy } = gitlab;
    const mergeable = {
      ...legacy,
      merge_status: 'can_be_merged',
      has_conflicts: false,
    };
    const actions = (overrides = {}, authenticated = true) =>
      requestActions(
        { ...mergeable, ...overrides },
        glProject,
        {},
        'gitlab',
        authenticated,
      );

    it('allows a mergeable MR without detailed_merge_status', () => {
      expect(actions().merge).toEqual({ allowed: true });
    });

    it.each([
      'cannot_be_merged',
      'checking',
      'unchecked',
      'unknown',
      'mergeable',
      undefined,
    ])('blocks an unresolved legacy status: %s', (merge_status) => {
      expect(actions({ merge_status }).merge.allowed).toBe(false);
    });

    it('reports explicit conflicts even when the merge status is stale', () => {
      expect(actions({ has_conflicts: true }).merge).toEqual({
        allowed: false,
        reason: '存在合并冲突。',
      });
    });

    it.each([
      'not_approved',
      'ci_must_pass',
      'discussions_not_resolved',
      'unknown',
      '',
    ])('keeps detailed status authoritative: %s', (detailed_merge_status) => {
      expect(actions({ detailed_merge_status }).merge.allowed).toBe(false);
    });

    it.each([
      { user: { can_merge: false } },
      { user: undefined },
      { draft: true },
      { work_in_progress: true },
      { state: 'closed' },
      { state: 'merged' },
      { diff_refs: undefined },
    ])(
      'preserves permission, draft, state and revision guards: %j',
      (overrides) => {
        expect(actions(overrides).merge.allowed).toBe(false);
      },
    );

    it('still requires authentication', () => {
      expect(actions({}, false).merge.allowed).toBe(false);
    });
  });
});

describe('review write requests', () => {
  let service: PullRequestsService, remote: string, current: any, project: any;
  let fetchMock: jest.SpiedFunction<typeof fetch>,
    getRemotes: jest.Mock,
    assertCurrent: jest.Mock;
  let failWrite: number | 'network' | undefined;
  const writes = () =>
    fetchMock.mock.calls.filter(([, options]) => options?.method);
  beforeEach(() => {
    remote = 'https://github.com/team/repo.git';
    current = structuredClone(github);
    project = ghProject;
    failWrite = undefined;
    getRemotes = jest.fn(async () => [{ name: 'origin', fetchUrl: remote }]);
    assertCurrent = jest.fn();
    service = new PullRequestsService(
      { getRemotes } as unknown as RepositoryService,
      {
        reconcile() {},
        selection() {},
        credential: () => ({ token: 'saved-secret', assertCurrent }),
      } as unknown as AccessTokensService,
    );
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        const url = String(input),
          gh = url.includes('api.github.com');
        if (options?.method) {
          if (failWrite === 'network') throw new Error('network saved-secret');
          if (failWrite)
            return json({ message: 'untrusted saved-secret' }, failWrite);
          const body = JSON.parse(String(options.body));
          if (url.endsWith('/merge'))
            return json(
              gh ? { merged: true } : { ...current, state: 'merged' },
            );
          if (options.method !== 'POST')
            return json({ ...current, state: 'closed' });
          const note = {
            id: 90,
            body: body.body,
            user: { login: 'alice' },
            author: { username: 'alice' },
            ...(gh
              ? {
                  path: body.path,
                  side: body.side,
                  line: body.line,
                  start_line: body.start_line,
                }
              : { position: body.position }),
          };
          return json(
            url.endsWith('/discussions')
              ? { id: 'discussion', notes: [note] }
              : note,
          );
        }
        if (url.endsWith('/user')) return json({ login: 'alice', id: 7 });
        if (url.includes('/files?'))
          return json([
            {
              filename: file.path,
              previous_filename: file.previousPath,
              status: 'renamed',
              patch,
              additions: 3,
              deletions: 2,
            },
          ]);
        if (url.includes('/diffs?'))
          return json([
            {
              new_path: file.path,
              old_path: file.previousPath,
              renamed_file: true,
              diff: patch,
            },
          ]);
        if (/\/(pulls|merge_requests)\/12$/.test(url)) return json(current);
        return json(project);
      });
  });
  afterEach(() => jest.restoreAllMocks());
  const useGitlab = () => {
    remote = 'https://git.example.com:8443/team/sub/repo.git';
    current = structuredClone(gitlab);
    project = glProject;
  };

  it('posts overview comments to issues/notes, code comments to pulls/discussions, with bound credentials', async () => {
    await service.mutate('repo', mutation());
    expect(String(writes()[0][0])).toBe(
      'https://api.github.com/repos/team/repo/issues/12/comments',
    );
    await service.mutate('repo', mutation({ position }));
    expect(String(writes()[1][0])).toBe(
      'https://api.github.com/repos/team/repo/pulls/12/comments',
    );
    expect(writes()[1][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer saved-secret' },
    });
    useGitlab();
    await service.mutate(
      'repo',
      mutation({ ...glQuery, revision: requestRevision(gitlab, 'gitlab') }),
    );
    expect(String(writes()[2][0])).toBe(
      'https://git.example.com:8443/api/v4/projects/team%2Fsub%2Frepo/merge_requests/12/notes',
    );
    const result = await service.mutate(
      'repo',
      mutation({
        ...glQuery,
        revision: requestRevision(gitlab, 'gitlab'),
        position,
      }),
    );
    expect(String(writes()[3][0])).toContain('/discussions');
    expect(result.discussion?.comments[0].context).toMatchObject({
      path: file.path,
      startLine: 11,
      newLine: 13,
    });
  });

  it('merges with an atomic SHA guard and closes using each provider method', async () => {
    await service.mutate(
      'repo',
      mutation({ action: 'merge', method: 'squash', body: undefined }),
    );
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      sha: head,
      merge_method: 'squash',
    });
    await service.mutate(
      'repo',
      mutation({ action: 'close', body: undefined }),
    );
    expect(writes()[1][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
    useGitlab();
    const gl = {
      ...glQuery,
      revision: requestRevision(gitlab, 'gitlab'),
      body: undefined,
    };
    await service.mutate(
      'repo',
      mutation({ ...gl, action: 'merge', method: 'merge' }),
    );
    expect(JSON.parse(String(writes()[2][1]?.body))).toEqual({
      sha: head,
      squash: false,
    });
    await service.mutate('repo', mutation({ ...gl, action: 'close' }));
    expect(writes()[3][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ state_event: 'close' }),
    });
  });

  it('reads and merges legacy GitLab MRs with a SHA guard, leaving final policy checks to GitLab', async () => {
    useGitlab();
    delete current.detailed_merge_status;
    current.merge_status = 'can_be_merged';
    current.has_conflicts = false;
    expect((await service.actions('repo', glQuery)).merge.allowed).toBe(true);
    const merge = () =>
      mutation({
        ...glQuery,
        revision: requestRevision(current, 'gitlab'),
        action: 'merge',
        method: 'merge',
        body: undefined,
      });
    await expect(service.mutate('repo', merge())).resolves.toEqual({
      state: 'merged',
    });
    expect(writes()[0][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ sha: head, squash: false }),
    });
    failWrite = 405;
    await expect(service.mutate('repo', merge())).rejects.toThrow(
      '平台拒绝合并',
    );
  });

  it('rechecks legacy GitLab conflicts immediately before writing', async () => {
    useGitlab();
    delete current.detailed_merge_status;
    current.merge_status = 'can_be_merged';
    current.has_conflicts = false;
    const original = fetchMock.getMockImplementation()!;
    let reads = 0;
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith('/merge_requests/12') && ++reads === 2)
        current.has_conflicts = true;
      return original(input, options);
    });
    await expect(
      service.mutate(
        'repo',
        mutation({
          ...glQuery,
          revision: requestRevision(current, 'gitlab'),
          action: 'merge',
          method: 'merge',
          body: undefined,
        }),
      ),
    ).rejects.toThrow('存在合并冲突');
    expect(writes()).toHaveLength(0);
  });

  it('deduplicates simultaneous and acknowledged retries and rejects ID reuse for another target', async () => {
    const body = mutation();
    await Promise.all([
      service.mutate('repo', body),
      service.mutate('repo', body),
    ]);
    await service.mutate('repo', body);
    expect(writes()).toHaveLength(1);
    expect(() => service.mutate('other-repo', body)).toThrow('操作编号');
  });

  it('retains uncertain submissions but permits retry of a definitive permission rejection', async () => {
    const body = mutation();
    failWrite = 'network';
    await expect(service.mutate('repo', body)).rejects.toThrow('结果尚未确认');
    failWrite = undefined;
    await expect(service.mutate('repo', body)).rejects.toThrow('结果尚未确认');
    expect(writes()).toHaveLength(1);
    const retry = mutation();
    failWrite = 403;
    await expect(service.mutate('repo', retry)).rejects.toThrow('权限');
    failWrite = undefined;
    await service.mutate('repo', retry);
    expect(writes()).toHaveLength(3);
  });

  it('rejects stale revisions, changed targets, unsupported ranges and disabled methods before writing', async () => {
    await expect(
      service.mutate('repo', mutation({ revision: 'f'.repeat(64) })),
    ).rejects.toThrow('Diff');
    await expect(
      service.mutate(
        'repo',
        mutation({ target: 'https://github.com/other/repo' }),
      ),
    ).rejects.toThrow('远端地址');
    await expect(
      service.mutate(
        'repo',
        mutation({ position: { ...position, startLine: 10 } }),
      ),
    ).rejects.toThrow('选区');
    await expect(
      service.mutate(
        'repo',
        mutation({ action: 'merge', method: 'rebase', body: undefined }),
      ),
    ).rejects.toThrow('合并方式');
    await expect(
      service.mutate('repo', mutation({ token: '' })),
    ).rejects.toThrow('令牌');
    expect(writes()).toHaveLength(0);
  });

  it('preserves a write receipt if the credential changes after dispatch', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, options) => {
      const response = await original(input, options);
      if (options?.method)
        assertCurrent.mockImplementation(() => {
          throw new Error('credential revoked');
        });
      return response;
    });
    const body = mutation();
    await expect(service.mutate('repo', body)).resolves.toHaveProperty(
      'discussion',
    );
    await service.mutate('repo', body);
    expect(writes()).toHaveLength(1);
  });

  it('rechecks remote and state after preflight and refuses a changed destination', async () => {
    getRemotes
      .mockResolvedValueOnce([{ name: 'origin', fetchUrl: remote }])
      .mockResolvedValue([
        { name: 'origin', fetchUrl: 'https://github.com/changed/repo.git' },
      ]);
    await expect(service.mutate('repo', mutation())).rejects.toThrow(
      '远端地址',
    );
    expect(writes()).toHaveLength(0);
  });

  it('refuses a request closed remotely between permission checks and the write', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, options) => {
      const response = await original(input, options);
      if (String(input).endsWith('/user')) current.state = 'closed';
      return response;
    });
    await expect(
      service.mutate('repo', mutation({ action: 'close', body: undefined })),
    ).rejects.toThrow('已关闭');
    expect(writes()).toHaveLength(0);
  });

  it('refuses a request that closes or changes head during file reads', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, options) => {
      const response = await original(input, options);
      if (String(input).includes('/files?')) current.head.sha = 'd'.repeat(40);
      return response;
    });
    await expect(
      service.mutate('repo', mutation({ position })),
    ).rejects.toThrow('Diff');
    expect(writes()).toHaveLength(0);
  });
});
