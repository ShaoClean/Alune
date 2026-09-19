// Run after building web: node apps/web/tests/diff-refresh-fixture.mjs
// Isolated browser regression fixture: no SSH, credentials or real Git writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const repo = {
  id: 'diff-reading',
  name: 'Diff 阅读回归',
  connectionId: 'fixture',
  path: '/fixture',
};
const connection = {
  id: 'fixture',
  name: '隔离测试',
  host: 'fixture.invalid',
  username: 'fixture',
  port: 22,
};
const files = [
  { path: 'long.txt', status: 'modified', staged: false },
  { path: 'other.txt', status: 'modified', staged: false },
  { path: 'new.txt', status: 'untracked', staged: false },
];
const control = { statusDelay: 0, diffDelay: 0, statusError: false, diffError: false, version: 1 };
const requests = [];
const commits = ['a', 'b'].map((letter) => ({
  hash: letter.repeat(40),
  shortHash: letter.repeat(7),
  parents: [],
  references: [],
  message: `History ${letter}`,
  author: 'Fixture',
  email: 'fixture@example.invalid',
  date: '2026-09-19T00:00:00Z',
}));
const json = (res, data, status = 200) =>
  res
    .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(data));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let body = {};
    if (req.method === 'POST') {
      let text = '';
      for await (const chunk of req) text += chunk;
      body = text ? JSON.parse(text) : {};
    }
    if (url.pathname === '/__fixture') {
      for (const key of Object.keys(control)) if (key in body) control[key] = body[key];
      return json(res, { control, requests, files });
    }
    if (url.pathname === '/api/connections') return json(res, [connection]);
    if (url.pathname === '/api/repositories') return json(res, [repo]);
    if (url.pathname === '/api/ai/settings')
      return json(res, {
        revision: 'fixture',
        providers: [],
        commit: {
          providerId: null,
          modelId: null,
          language: 'zh-CN',
          format: 'conventional',
          prompt: '',
        },
        secretStorage: { available: true, description: '隔离测试' },
      });
    const match = url.pathname.match(/^\/api\/repositories\/diff-reading(?:\/(.*))?$/);
    if (match) {
      const action = match[1];
      if (!action) return json(res, repo);
      requests.push({ action, params: Object.fromEntries(url.searchParams), time: Date.now() });
      if (action === 'status') {
        const state = {
          branch: 'main',
          ahead: requests.length,
          behind: 0,
          files: structuredClone(files),
        };
        await pause(control.statusDelay);
        return json(
          res,
          control.statusError ? { message: 'Status unavailable' } : state,
          control.statusError ? 503 : 200,
        );
      }
      if (action === 'diff') {
        const {
          file = 'all',
          staged = 'false',
          commit = 'worktree',
        } = Object.fromEntries(url.searchParams);
        const version = control.version;
        const error = control.diffError;
        const patch =
          `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,400 +1,400 @@\n` +
          Array.from(
            { length: 400 },
            (_, i) =>
              `-old ${i + 1}\n+${file} ${staged} ${commit} version ${version} line ${i + 1}\n`,
          ).join('');
        await pause(control.diffDelay);
        return json(res, error ? { message: 'Diff unavailable' } : patch, error ? 503 : 200);
      }
      if (action === 'log')
        return json(res, {
          commits,
          hasMore: false,
          nextSkip: 2,
          revision: 'history',
          shallow: false,
        });
      if (action === 'commit-files')
        return json(res, [
          { path: 'long.txt', status: 'modified', additions: 400, deletions: 400 },
        ]);
      if (action === 'branches') return json(res, [{ name: 'main', current: true }]);
      if (action === 'delete-new-file/preview')
        return json(res, {
          path: body.path,
          token: 'fixture',
          diskPresent: true,
          staged: false,
          hasUnstagedChanges: true,
        });
      if (action === 'stage' || action === 'unstage') {
        for (const file of files)
          if (body.files?.includes(file.path)) file.staged = action === 'stage';
        control.version++;
      }
      if (action === 'checkout' || action === 'delete-new-file' || action === 'commit') {
        for (let index = files.length - 1; index >= 0; index--) {
          if (
            action === 'commit'
              ? files[index].staged
              : body.files?.includes(files[index].path) || body.path === files[index].path
          )
            files.splice(index, 1);
        }
        control.version++;
      }
      return json(res, []);
    }
    if (url.pathname.startsWith('/api/')) return json(res, []);
    const file = path.resolve(
      root,
      url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html',
    );
    if (!file.startsWith(root + path.sep)) return json(res, {}, 403);
    const content = await readFile(file);
    const type =
      { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] ||
      'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(content);
  } catch (error) {
    json(res, { message: error.message }, 500);
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`Diff fixture: http://127.0.0.1:${server.address().port}/repositories/${repo.id}`),
);
