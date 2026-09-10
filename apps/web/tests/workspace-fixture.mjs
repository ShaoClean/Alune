import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Browser acceptance only: all Git writes change memory, never SSH or a real repository.
const root = path.resolve(process.argv[2] || fileURLToPath(new URL('../dist/', import.meta.url)));
const connections = [
  {
    id: 'dev',
    name: '开发服务器',
    host: 'fixture.invalid',
    port: 22,
    username: 'fixture',
    authType: 'sshAgent',
  },
  {
    id: 'test',
    name: '预发布服务器',
    host: 'fixture.invalid',
    port: 22,
    username: 'fixture',
    authType: 'sshAgent',
  },
];
const repositories = [
  { id: 'repo-a', name: 'remote-git', connectionId: 'dev', path: '/workspace/remote-git' },
  { id: 'repo-b', name: 'design-system', connectionId: 'dev', path: '/workspace/design-system' },
  { id: 'empty', name: 'empty-repo', connectionId: 'test', path: '/workspace/empty' },
];
const initialFiles = [
  {
    path: 'apps/web/src/components/Layout.tsx',
    status: 'modified',
    staged: false,
    additions: 13,
    deletions: 2,
  },
  {
    path: 'apps/web/src/components/ChangesView.tsx',
    status: 'modified',
    staged: false,
    additions: 6,
    deletions: 1,
  },
  {
    path: 'apps/web/src/pages/RepositoryDetailPage.tsx',
    status: 'modified',
    staged: false,
    additions: 3,
    deletions: 1,
  },
  {
    path: 'apps/web/src/stores/workspaceStore.ts',
    status: 'modified',
    staged: false,
    additions: 5,
    deletions: 0,
  },
  {
    path: 'apps/web/tests/workspace-layout.test.mjs',
    status: 'untracked',
    staged: false,
    additions: 9,
    deletions: 0,
  },
  { path: 'apps/web/src/index.css', status: 'modified', staged: true, additions: 6, deletions: 1 },
  {
    path: 'apps/web/src/components/PanelResizeHandle.tsx',
    status: 'added',
    staged: true,
    additions: 8,
    deletions: 0,
  },
];
const actions = [];
let states;
const reset = () => {
  states = Object.fromEntries(
    repositories.map((repo, i) => [
      repo.id,
      {
        branch: i === 1 ? 'main' : 'design/workspace-layout',
        files: i === 0 ? structuredClone(initialFiles) : [],
        ahead: i === 0 ? 2 : 0,
        behind: 0,
      },
    ]),
  );
  actions.length = 0;
};
reset();
const json = (response, body, code = 200) =>
  response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname === '/__fixture/actions') return json(response, actions);
  if (pathname === '/__fixture/reset' && request.method === 'POST') {
    reset();
    return json(response, { ok: true });
  }
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/connections') return json(response, connections);
    if (pathname === '/api/repositories') return json(response, repositories);
    const [, , , id, operation] = pathname.split('/');
    const repo = repositories.find((repo) => repo.id === id);
    const state = states[id];
    if (!repo) return json(response, { message: '测试仓库不存在' }, 404);
    if (request.method === 'GET') {
      if (!operation) return json(response, repo);
      if (operation === 'status') return json(response, state);
      if (operation === 'branches')
        return json(
          response,
          ['design/workspace-layout', 'main'].map((name) => ({
            name,
            isCurrent: name === state.branch,
            isRemote: false,
          })),
        );
      if (operation === 'log')
        return json(
          response,
          id === 'repo-a'
            ? [
                {
                  hash: 'abc1234567890',
                  shortHash: 'abc1234',
                  message: 'feat: 支持工作区布局调整',
                  author: 'Fixture',
                  email: 'fixture@example.invalid',
                  date: '2026-09-10T08:00:00Z',
                  refs: ['HEAD -> design/workspace-layout'],
                },
              ]
            : [],
        );
      if (operation === 'commit-files') return json(response, initialFiles.slice(0, 3));
      if (operation === 'remotes')
        return json(response, [
          {
            name: 'origin',
            fetchUrl: 'https://example.invalid/team/remote-git.git',
            pushUrl: 'https://example.invalid/team/remote-git.git',
          },
        ]);
      if (operation === 'diff') {
        const file = url.searchParams.get('file') || initialFiles[0].path;
        return json(
          response,
          `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,5 +1,9 @@\n import { WorkspaceTree } from './WorkspaceTree';\n-export const sidebarWidth = 280;\n+export const sidebarWidth = 220;\n+export const changesWidth = 340;\n+// ${id} · ${url.searchParams.get('staged') === 'true' ? '已暂存' : '工作区'}\n export function Workspace() {\n-  return <LegacyLayout />;\n+  return <ResizableWorkspace />;\n }\n`,
        );
      }
      return json(response, []);
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    let body;
    try {
      body = JSON.parse(text || '{}');
    } catch {
      return json(response, { message: 'Invalid JSON' }, 400);
    }
    actions.push({ id, operation, body });
    if (operation === 'stage' || operation === 'unstage')
      state.files = state.files.map((file) =>
        body.files.includes(file.path) ? { ...file, staged: operation === 'stage' } : file,
      );
    else if (operation === 'commit') {
      state.files = state.files.filter((file) => !file.staged);
      state.ahead++;
    } else if (operation === 'checkout')
      state.files = state.files.filter((file) => !body.files.includes(file.path));
    else if (operation === 'push') state.ahead = 0;
    else if (operation === 'pull') state.behind = 0;
    else if (operation === 'switch') state.branch = body.name;
    else if (operation !== 'fetch')
      return json(response, { message: 'Unsupported fixture action' }, 405);
    return json(response, { success: true });
  }
  const file = path.resolve(root, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
  if (path.relative(root, file).startsWith('..')) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    const type =
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }).end(content);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`Workspace fixture: http://127.0.0.1:${server.address().port}`),
);
