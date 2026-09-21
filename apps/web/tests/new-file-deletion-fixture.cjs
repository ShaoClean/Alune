// Local acceptance fixture: actual GitService, Git commands and disposable disk.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { GitCommands } = require('@alune/ssh-client');
const { GitService } = require('../../server/dist/git/git.service');

async function createFixture() {
  const fixture = createRepository();
  const connection = {
    id: '11111111-1111-4111-8111-111111111111',
    name: '删除验收',
    host: 'fixture.invalid',
    username: 'fixture',
    port: 22,
  };
  const repo = {
    id: '22222222-2222-4222-8222-222222222222',
    name: '新增文件删除验收',
    path: fixture.repo,
    connectionId: connection.id,
  };
  fixture.write('loose.txt');
  fixture.write('mixed.ts', 'export const value = 1;\n');
  fixture.write('staged.ts', 'export const staged = true;\n');
  fixture.write('目录/中文 空格 [特殊].txt');
  fixture.write('retry.txt');
  fixture.git('add', '--', 'mixed.ts', 'staged.ts', 'retry.txt');
  fixture.write('mixed.ts', 'export const value = 2;\n');
  const control = { failUnlink: false, delayMs: 0, deleteCalls: 0, previewCalls: 0 };
  fixture.connection.withSftp = (operation) =>
    operation({
      ...fs,
      unlink(filename, done) {
        if (control.failUnlink)
          done(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));
        else fs.unlink(filename, done);
      },
    });
  const service = new GitService(
    { ensureConnected: async () => fixture.connection },
    { get: async () => repo },
  );
  const git = new GitCommands(fixture.connection);
  const webRoot = path.resolve(__dirname, '../dist');
  const json = (res, value, code = 200) =>
    res
      .writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(value));
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
        for (const key of ['failUnlink', 'delayMs']) if (key in body) control[key] = body[key];
        if (body.edit) fixture.write(body.edit, 'externally changed\n');
        return json(res, {
          repo,
          control,
          status: await git.status(fixture.repo),
          index: fixture.git('ls-files', '--stage', '-z'),
        });
      }
      if (url.pathname === '/api/connections') return json(res, [connection]);
      if (url.pathname === '/api/repositories') return json(res, [repo]);
      const match = url.pathname.match(/^\/api\/repositories\/([^/]+)(?:\/(.*))?$/);
      if (match) {
        const action = match[2];
        if (!action) return json(res, repo);
        if (action === 'status') return json(res, await git.status(fixture.repo));
        if (action === 'diff')
          return json(
            res,
            await git.diff(fixture.repo, {
              file: url.searchParams.get('file'),
              staged: url.searchParams.get('staged') === 'true',
            }),
          );
        if (action === 'delete-new-file/preview') {
          control.previewCalls++;
          return json(res, await service.deleteNewFile(repo.id, body.path, undefined, true));
        }
        if (action === 'delete-new-file') {
          control.deleteCalls++;
          if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
          return json(res, await service.deleteNewFile(repo.id, body.path, body.token));
        }
        if (['stage', 'unstage', 'checkout'].includes(action))
          return json(res, await service[action](repo.id, body.files));
        return json(res, []);
      }
      if (url.pathname.startsWith('/socket.io')) return json(res, {}, 404);
      const filename = path.resolve(
        webRoot,
        url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html',
      );
      if (path.relative(webRoot, filename).startsWith('..')) return json(res, {}, 403);
      res
        .writeHead(200, {
          'Content-Type':
            { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[
              path.extname(filename)
            ] || 'application/octet-stream',
        })
        .end(await readFile(filename));
    } catch (error) {
      json(res, { message: error.message }, error.getStatus?.() || 500);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fixture.close();
    },
  };
}
module.exports = { createFixture };
if (require.main === module)
  createFixture().then((fixture) => {
    console.log(fixture.origin);
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => fixture.close().then(() => process.exit()));
  });
