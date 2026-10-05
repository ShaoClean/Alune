const { startPullRequestsFixture } = require('./pull-requests-fixture.cjs');
const { RepositoryService } = require('../../server/dist/repository/repository.service');
const { AiService } = require('../../server/dist/ai/ai.service');

async function startCreationFixture({ authenticate = false } = {}) {
  const fixture = await startPullRequestsFixture();
  const git = fixture.fixture.git;
  const base = git('rev-parse', 'HEAD').trim();
  if (git('branch', '--show-current').trim() !== 'main') git('branch', 'main');
  git('switch', '-qc', 'feature/create-pr');
  fixture.fixture.write('entry.ts', 'export const createPullRequest = true;\n');
  git('add', 'entry.ts');
  git('commit', '-qm', 'feat: 应用内创建 PR/MR');
  const head = git('rev-parse', 'HEAD').trim();
  fixture.fixture.write('private.txt', 'UNCOMMITTED_PRIVATE_CONTENT');
  const local = await fixture.app.get(RepositoryService).addLocal(fixture.fixture.repo);
  const control = {
    published: true,
    base,
    template: true,
    huge: false,
    writeStatus: 200,
    calls: [],
    created: [],
    ai: [],
  };
  const fallback = globalThis.fetch;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const patch = '@@ -0,0 +1 @@\n+export const createPullRequest = true;';
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'ai.fixture.invalid') {
      const body = JSON.parse(options.body);
      control.ai.push(body);
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'feat: 在应用内创建 PR/MR',
                description: '## 改动\n添加创建入口。\n\n## 验证\n待用户核对。',
              }),
            },
          },
        ],
      });
    }
    if (!['api.github.com', 'gitlab.example.com', 'gitlab.com'].includes(url.hostname))
      return fallback(input, options);
    const github = url.hostname === 'api.github.com';
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    control.calls.push({ path: url.pathname, method, body, host: url.host });
    if (!github && !options.headers['PRIVATE-TOKEN']) return json({}, 401);
    const collection = /\/(pulls|merge_requests)$/.test(url.pathname);
    if (collection && method === 'POST') {
      if (control.writeStatus !== 200) return json({}, control.writeStatus);
      const number = 201 + control.created.length;
      const item = {
        number,
        iid: number,
        title: body.title,
        state: github ? 'open' : 'opened',
        draft: body.draft || body.title.startsWith('Draft:'),
        user: { login: 'fixture' },
        author: { username: 'fixture' },
        updated_at: new Date().toISOString(),
        body: body.body,
        description: body.description,
        changed_files: 1,
        changes_count: '1',
        head: { ref: body.head, sha: head },
        base: { ref: body.base, sha: control.base },
        source_branch: body.source_branch,
        target_branch: body.target_branch,
        mergeable: true,
        mergeable_state: 'clean',
        diff_refs: { head_sha: head, base_sha: control.base, start_sha: control.base },
      };
      control.created.push({ ...item, host: url.host });
      return json(item, 201);
    }
    if (collection && (url.searchParams.has('head') || url.searchParams.has('source_branch')))
      return json(control.created.filter((item) => item.host === url.host));
    if (collection && method === 'GET' && control.created.some((item) => item.host === url.host))
      return json(control.created.filter((item) => item.host === url.host));
    if (/\/(pulls|merge_requests)\/\d+$/.test(url.pathname) && method === 'GET') {
      const item = control.created.find(
        (item) => item.host === url.host && item.number === Number(url.pathname.split('/').at(-1)),
      );
      if (item) return json(item);
    }
    if (url.pathname.includes('/branches/')) {
      const source =
        decodeURIComponent(url.pathname.split('/branches/')[1]) === 'feature/create-pr';
      if (source && !control.published) return json({}, 404);
      return json({
        commit: { sha: source ? head : control.base, id: source ? head : control.base },
      });
    }
    if (url.pathname.endsWith('/branches'))
      return json([{ name: 'main' }, { name: 'release' }, { name: 'feature/create-pr' }]);
    if (url.pathname.includes('/compare')) {
      const files = Array.from({ length: control.huge ? 300 : 1 }, (_, i) => ({
        filename: `entry${i || ''}.ts`,
        new_path: `entry${i || ''}.ts`,
        status: 'added',
        new_file: true,
        additions: 1,
        deletions: 0,
        patch: control.huge ? patch.repeat(300) : patch,
        diff: control.huge ? patch.repeat(300) : patch,
      }));
      return json({
        commits: [
          {
            sha: head,
            id: head,
            message: 'feat: 应用内创建 PR/MR',
            commit: { message: 'feat: 应用内创建 PR/MR' },
          },
        ],
        files: github ? files : undefined,
        diffs: github ? undefined : files,
      });
    }
    if (url.pathname.includes('/contents/') || url.pathname.includes('/repository/files/'))
      return control.template
        ? json({
            encoding: 'base64',
            content: Buffer.from('## 改动\n\n## 验证\n').toString('base64'),
          })
        : json({}, 404);
    if (/\/(assignees|collaborators|members\/all)$/.test(url.pathname))
      return json([{ login: 'reviewer', id: 7, username: 'reviewer', name: 'Reviewer' }]);
    if (url.pathname.endsWith('/labels')) return json([{ name: 'enhancement' }]);
    if (
      /\/repos\/[^/]+\/[^/]+$/.test(url.pathname) ||
      /\/api\/v4\/projects\/[^/]+$/.test(url.pathname)
    ) {
      return json({
        default_branch: 'main',
        permissions: github ? { push: true } : { project_access: { access_level: 40 } },
        allow_merge_commit: true,
        merge_method: 'merge',
        squash_option: 'default_off',
      });
    }
    return fallback(input, options);
  };
  const settings = fixture.app.get(AiService).settings;
  const saved = settings.saveProvider(
    undefined,
    {
      name: '测试 AI',
      protocol: 'openai',
      baseUrl: 'https://ai.fixture.invalid/v1',
      enabled: true,
      models: [{ id: 'fixture-model', name: 'Fixture', enabled: true }],
      apiKey: 'fixture-ai-secret',
    },
    settings.read().revision,
  );
  settings.saveCommit(
    {
      providerId: saved.providers.at(-1).id,
      modelId: 'fixture-model',
      language: 'zh-CN',
      format: 'conventional',
      prompt: '',
    },
    settings.read().revision,
  );
  if (authenticate) {
    const jsonRequest = async (path, body) => {
      const response = await fetch(`${fixture.url}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    let tokens = await jsonRequest('/access-tokens');
    tokens = await jsonRequest('/access-tokens', {
      name: '界面测试令牌',
      value: 'fixture-ui-token',
      revision: tokens.revision,
    });
    const tokenId = tokens.tokens[0].id;
    for (const repo of [fixture.main, local])
      tokens = await jsonRequest(`/repositories/${repo.id}/pull-requests/token`, {
        remote: 'origin',
        target: 'https://github.com/fixture/alune',
        provider: 'github',
        tokenId,
        revision: tokens.revision,
      });
  }
  return {
    ...fixture,
    local,
    creation: control,
    async close() {
      globalThis.fetch = fallback;
      await fixture.close();
    },
  };
}
module.exports = { startCreationFixture };
if (require.main === module)
  startCreationFixture({ authenticate: true })
    .then((fixture) => {
      console.log(
        JSON.stringify({
          url: `${fixture.url}/repositories/${fixture.main.id}?panel=pull-requests&createPr=1`,
          localUrl: `${fixture.url}/repositories/${fixture.local.id}?panel=pull-requests&createPr=1`,
        }),
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => void fixture.close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
