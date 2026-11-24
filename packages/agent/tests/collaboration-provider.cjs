// Test-process preload. No request can reach a real platform.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.env.ALUNE_P6_FIXTURE;
const json = (value) => Response.json(value);
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.host === 'ai.fixture.invalid') {
    const body = JSON.parse(init.body);
    if (
      init.headers.Authorization !== 'Bearer fixture-ai-secret' ||
      !JSON.stringify(body).includes('STAGED_ONLY') ||
      JSON.stringify(body).includes('PRIVATE_UNSTAGED')
    )
      throw Error('invalid scope');
    if (fs.existsSync(path.join(root, 'change-index')))
      execFileSync('git', ['-C', path.join(root, 'repo'), 'add', 'tracked']);
    return json({
      choices: [{ message: { content: '{"message":"fixture commit","description":""}' } }],
    });
  }
  if (url.host === 'gitlab.fixture.invalid') {
    if (init.headers['PRIVATE-TOKEN'] !== 'fixture-gitlab-secret' || init.method)
      throw Error('invalid GitLab scope');
    if (url.pathname.endsWith('/notes') && url.searchParams.get('sort') === 'desc')
      return Response.json(
        [
          { id: 21, body: 'private comment', created_at: '2026-11-04T00:00:00Z' },
          { id: 22, body: 'system update', system: true, created_at: '2026-11-04T00:00:00Z' },
          { id: 23, body: 'old comment', created_at: '2026-11-02T00:00:00Z' },
        ],
        { headers: { 'x-next-page': '2' } },
      );
    if (url.pathname.endsWith('/approvals'))
      return json({
        approved: true,
        approved_by: [{ user: { id: 10 }, approved_at: '2026-11-04T00:00:00Z' }],
      });
    throw Error('unexpected GitLab fixture request');
  }
  if (
    url.host !== 'api.github.com' ||
    init.headers.Authorization !== 'Bearer fixture-review-secret'
  )
    throw Error('invalid platform route');
  if (url.pathname === '/user') return json({ login: 'fixture' });
  if (url.pathname === '/repos/team/repo') return json({ permissions: { push: true } });
  if (url.pathname === '/repos/team/repo/pulls')
    return json([
      {
        number: 12,
        title: 'test',
        state: 'closed',
        updated_at: '2026-11-05T00:00:00Z',
        merged_at: '2026-11-05T00:00:00Z',
      },
    ]);
  if (url.pathname === '/repos/team/repo/pulls/12/reviews')
    return json([
      { id: 13, state: 'PENDING' },
      { id: 14, state: 'APPROVED', submitted_at: '2026-11-02T00:00:00Z', body: 'private review' },
    ]);
  if (
    url.pathname === '/repos/team/repo/issues/12/comments' &&
    !init.method &&
    url.searchParams.has('since')
  )
    return Response.json(
      [
        { id: 11, created_at: '2026-11-02T00:00:00Z', body: 'edited old comment' },
        { id: 12, created_at: '2026-11-04T00:00:00Z', body: 'private comment' },
      ],
      { headers: { link: '<https://api.github.com/next>; rel="next"' } },
    );
  if (url.pathname === '/repos/team/repo/pulls/12')
    return json({
      number: 12,
      title: 'test',
      state: 'open',
      updated_at: '2026-11-01T00:00:00Z',
      user: { login: 'fixture' },
      base: { ref: 'main', sha: 'a'.repeat(40) },
      head: { ref: 'work', sha: 'b'.repeat(40) },
    });
  if (url.pathname === '/repos/team/repo/issues/12/comments' && init.method === 'POST') {
    fs.appendFileSync(path.join(root, 'dispatched'), 'comment\n');
    throw Error('simulated lost reply after remote accepted request');
  }
  throw Error('unexpected fixture request');
};
