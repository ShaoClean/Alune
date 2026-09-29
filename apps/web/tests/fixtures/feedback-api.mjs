// Isolated, synthetic API for manual browser/Electron feedback acceptance.
// Start with: node apps/web/tests/fixtures/feedback-api.mjs [port]
// POST /__faults {"log":true}; POST /__faults {} restores healthy responses.
import { createServer } from 'node:http';
let faults = {};
const requests = [];
const repo = {
  id: 'feedback-demo',
  name: 'Alune · 验收仓库',
  path: '/demo/alune',
  source: 'local',
  currentBranch: 'development',
  isDirty: true,
};
const remote = {
  name: 'origin',
  fetchUrl: 'https://github.com/example/alune-demo.git',
  pushUrl: 'https://github.com/example/alune-demo.git',
};
const prRemote = {
  name: 'origin',
  host: 'github.com',
  project: 'example/alune-demo',
  webUrl: 'https://github.com/example/alune-demo',
  provider: 'github',
  selection: { status: 'applied', tokenId: null, version: 'v1', provider: 'github' },
};
const commit = {
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  message: '统一页面反馈与仓库说明',
  author: 'Alune Demo',
  email: 'demo@example.com',
  date: '2026-09-29T00:00:00Z',
  parents: [],
  references: [
    { name: 'development', fullName: 'refs/heads/development', kind: 'local', current: true },
  ],
};
const ai = {
  revision: 'v1',
  secretStorage: { available: true },
  providers: [
    {
      id: 'demo',
      name: '验收服务商',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1',
      enabled: true,
      hasApiKey: true,
      models: [{ id: 'demo-model', name: 'Demo Model', enabled: true }],
    },
  ],
  commit: {
    providerId: 'demo',
    modelId: 'demo-model',
    language: 'zh-CN',
    format: 'conventional',
    maxTokens: 1024,
    temperature: 0.3,
    instructions: '',
  },
};
const proxy = {
  revision: 'v1',
  enabled: false,
  protocol: 'http',
  host: '127.0.0.1',
  port: 7890,
  authEnabled: false,
  hasCredentials: false,
  secretStorageAvailable: true,
};
const diff =
  'diff --git a/README.md b/README.md\nindex 1234567..7654321 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,5 @@\n # Alune\n\n-页面内提示\n+统一反馈弹窗\n+保留重试与刷新入口\n+保持工作区布局稳定\n';
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api/, '');
  const chunks = [];
  for await (const part of req) chunks.push(part);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (value, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(value));
  };
  if (path === '/__faults') {
    faults = body;
    return send(faults);
  }
  if (path === '/__requests') return send(requests);
  requests.push(`${req.method} ${path}`);
  const operation = path.split('/').at(-1);
  const fault = faults[path] || faults[operation];
  if (fault) {
    if (typeof fault === 'object' && fault.delay)
      await new Promise((resolve) => setTimeout(resolve, fault.delay));
    return send(
      {
        message:
          typeof fault === 'string'
            ? fault
            : '验收模拟：服务暂时不可用。请重试，当前内容与草稿仍保留。',
      },
      503,
    );
  }
  if (path === '/connections' || path === '/network-proxy/connections') return send([]);
  if (path === '/repositories')
    return send([
      repo,
      { ...repo, id: 'second-demo', name: '第二个验收仓库', path: '/demo/second' },
    ]);
  if (/^\/repositories\/[^/]+$/.test(path))
    return send(
      path.endsWith('second-demo') ? { ...repo, id: 'second-demo', name: '第二个验收仓库' } : repo,
    );
  if (operation === 'status')
    return send({
      branch: 'development',
      upstream: 'origin/development',
      ahead: 1,
      behind: 0,
      files: [
        { path: 'README.md', status: 'M', staged: false },
        { path: 'src/feedback.ts', status: 'M', staged: true },
      ],
    });
  if (operation === 'context')
    return send({
      ...repo,
      author: faults.noAuthor
        ? { name: '', email: '' }
        : { name: 'Alune Demo', email: 'demo@example.com' },
      shallow: !!faults.shallow,
      unborn: !!faults.unborn,
      upstream: 'origin/development',
      remotes: faults.noRemote ? [] : [remote],
    });
  if (operation === 'operation') return send(null);
  if (['fetch', 'push', 'pull'].includes(operation))
    return send({ message: 'Git 操作已取消；已完成的步骤不会回滚，请刷新仓库状态。' }, 409);
  if (operation === 'log')
    return send({
      commits: Array.from({ length: 18 }, (_, i) => ({
        ...commit,
        hash: i.toString(16).padStart(40, 'a'),
        shortHash: `a${String(i).padStart(6, '0')}`,
        message: `${commit.message} ${i + 1}`,
      })),
      hasMore: false,
      nextSkip: 18,
      revision: 'r1',
      shallow: !!faults.shallow,
    });
  if (operation === 'commit-files')
    return send([{ path: 'README.md', status: 'modified', additions: 3, deletions: 1 }]);
  if (operation === 'diff') return send(diff);
  if (path.endsWith('/pull-requests/remotes'))
    return send([
      prRemote,
      {
        ...prRemote,
        name: 'upstream',
        project: 'example/upstream',
        webUrl: 'https://github.com/example/upstream',
      },
    ]);
  if (path.endsWith('/pull-requests/list'))
    return send({
      items: [
        {
          number: 118,
          title: '统一页面反馈提示',
          author: 'Alune Demo',
          sourceBranch: 'feedback',
          targetBranch: 'development',
          state: 'open',
          updatedAt: '2026-09-29T00:00:00Z',
          url: 'https://github.com/example/alune-demo/pull/118',
        },
      ],
      hasMore: false,
    });
  if (operation === 'remotes') return send([remote]);
  if (operation === 'branches')
    return send([{ name: 'development', current: true, remote: false }]);
  if (operation === 'stashes' || operation === 'worktrees') return send([]);
  if (operation === 'tree')
    return send({
      path: '',
      entries: ['README.md', 'package.json', 'feedback.ts'].map((name) => ({
        name,
        path: name,
        kind: 'file',
      })),
      total: 3,
      truncated: false,
    });
  if (operation === 'file')
    return send({
      path: url.searchParams.get('path'),
      kind: 'text',
      size: 62,
      encoding: 'utf-8',
      content: '# Alune\n\n用于反馈弹窗验收的隔离内容。\n',
    });
  if (path === '/access-tokens')
    return send({ revision: 'v1', tokens: [], secretStorage: { available: true } });
  if (path === '/network-proxy')
    return send({
      ...proxy,
      revision: faults.outdated ? 'v2' : 'v1',
      ...(req.method === 'PUT' ? body : {}),
    });
  if (path.startsWith('/ai/')) return send(ai);
  send({ message: `Fixture route not found: ${path}` }, 404);
});
server.listen(Number(process.argv[2] || 3198), '127.0.0.1', () =>
  console.log(`Feedback fixture listening on ${server.address().port}`),
);
