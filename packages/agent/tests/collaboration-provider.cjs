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
  if (
    url.host !== 'api.github.com' ||
    init.headers.Authorization !== 'Bearer fixture-review-secret'
  )
    throw Error('invalid platform route');
  if (url.pathname === '/user') return json({ login: 'fixture' });
  if (url.pathname === '/repos/team/repo') return json({ permissions: { push: true } });
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
