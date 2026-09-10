// Isolated acceptance fixture: real in-memory SQLite + RepositoryService, simulated SSH/Git.
// The optional legacy mode transpiles the exact baseline service from Git for comparison.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const Database = require('better-sqlite3');
const { GitCommands } = require('@remote-git/ssh-client');
const { RepositoryService } = require('../../server/dist/repository/repository.service');
const root = path.resolve(__dirname, '../../..');
const baseline = '9c260f6';

function legacyService() {
  const ts = require('typescript');
  const source = execFileSync(
    'git',
    ['show', `${baseline}:apps/server/src/repository/repository.service.ts`],
    { cwd: root, encoding: 'utf8' },
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      esModuleInterop: true,
    },
  }).outputText;
  const filename = path.join(root, 'apps/server/src/repository/legacy-fixture.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports.RepositoryService;
}

async function createFixture({
  legacy = false,
  count = 24,
  webRoot = path.join(root, 'apps/web/dist'),
} = {}) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE connections (id TEXT PRIMARY KEY)');
  const connections = ['alpha', 'beta', 'empty'].map((id) => ({
    id,
    name: `Fixture ${id}`,
    host: 'fixture.invalid',
    username: 'fixture',
    port: 22,
    authType: 'password',
  }));
  for (const { id } of connections) db.prepare('INSERT INTO connections VALUES (?)').run(id);
  const control = {
    listError: false,
    offline: false,
    slowMs: 800,
    fastMs: 40,
    failIds: [],
    delayIds: {},
    calls: [],
  };
  const connectionService = {
    ensureConnected: async () => {
      if (control.offline) throw new Error('模拟连接拒绝，请重试');
      return {};
    },
  };
  const service = new (legacy ? legacyService() : RepositoryService)(db, connectionService);
  const registry = [];
  for (let index = 0; index < count; index++)
    registry.push(
      await service.add(
        index % 2 ? 'beta' : 'alpha',
        `/fixture/repository-${String(index + 1).padStart(2, '0')}`,
      ),
    );
  const originalStatus = GitCommands.prototype.status;
  GitCommands.prototype.status = async function (repoPath, signal) {
    const repo = registry.find((item) => item.path === repoPath);
    const call = { id: repo.id, startedAt: performance.now(), completedAt: null };
    control.calls.push(call);
    const delay =
      control.delayIds[repo.id] ?? (repo.id === registry[0].id ? control.slowMs : control.fastMs);
    await new Promise((resolve, reject) => {
      let timer;
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, delay);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    call.completedAt = performance.now();
    if (control.failIds.includes(repo.id)) throw new Error('模拟 Git 状态读取失败');
    return {
      branch: repo.id === registry[1]?.id ? 'feature/fixture' : 'main',
      files:
        repo.id === registry[1]?.id
          ? [{ path: 'fixture.txt', status: 'modified', staged: false }]
          : [],
      ahead: 1,
      behind: 0,
    };
  };
  const json = (res, body, code = 200) =>
    res
      .writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(body));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/__fixture') {
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const patch = JSON.parse(body);
          for (const key of ['listError', 'offline', 'slowMs', 'fastMs', 'failIds', 'delayIds'])
            if (key in patch) control[key] = patch[key];
          if (patch.resetCalls) control.calls.length = 0;
        }
        return json(res, { legacy, registry, control });
      }
      if (url.pathname === '/api/connections') return json(res, connections);
      if (url.pathname === '/api/repositories/scan')
        return json(res, ['/fixture/scanned-repository']);
      if (url.pathname === '/api/repositories') {
        if (req.method === 'POST') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const { connectionId, path: repoPath } = JSON.parse(body);
          const added = await service.add(connectionId, repoPath);
          registry.push(added);
          return json(res, added);
        }
        if (control.listError) return json(res, { message: '模拟注册列表读取失败' }, 503);
        return json(res, await service.list());
      }
      const match = url.pathname.match(/^\/api\/repositories\/([^/]+)(?:\/(\w+))?$/);
      if (match) {
        if (req.method === 'DELETE') {
          await service.delete(match[1]);
          return json(res, { ok: true });
        }
        if (match[2] === 'status') return json(res, await service.getStatus(match[1]));
        if (!match[2]) return json(res, await service.get(match[1]));
        return json(res, []);
      }
      if (url.pathname.startsWith('/socket.io')) return json(res, {}, 404);
      const filename = path.resolve(
        webRoot,
        url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html',
      );
      if (path.relative(webRoot, filename).startsWith('..')) return json(res, {}, 403);
      const content = await readFile(filename);
      res
        .writeHead(200, {
          'Content-Type':
            { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[
              path.extname(filename)
            ] || 'application/octet-stream',
        })
        .end(content);
    } catch (error) {
      json(res, { message: error.message }, error.status || 500);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    service,
    registry,
    control,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      GitCommands.prototype.status = originalStatus;
    },
  };
}
module.exports = { createFixture, baseline };
if (require.main === module) {
  if (process.argv.includes('--benchmark')) {
    (async () => {
      const results = [];
      for (const legacy of [true, false]) {
        const fixture = await createFixture({ legacy });
        for (let run = 1; run <= 3; run++) {
          fixture.control.calls.length = 0;
          const start = performance.now();
          await (await fetch(`${fixture.origin}/api/repositories`)).json();
          const registryMs = performance.now() - start;
          if (!legacy) {
            const ids = fixture.registry.map((repo) => repo.id);
            await Promise.all(
              [0, 1].map(async () => {
                while (ids.length)
                  await (
                    await fetch(`${fixture.origin}/api/repositories/${ids.shift()}/status`)
                  ).json();
              }),
            );
          }
          results.push({
            legacy,
            run,
            count: fixture.registry.length,
            registryMs: +registryMs.toFixed(2),
            remoteCompleteMs: +(performance.now() - start).toFixed(2),
          });
        }
        await fixture.close();
      }
      console.log(
        JSON.stringify(
          {
            baseline,
            node: process.version,
            platform: `${process.platform}/${process.arch}`,
            simulatedLatency: { firstRepoMs: 800, otherReposMs: 40 },
            results,
          },
          null,
          2,
        ),
      );
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else {
    createFixture({
      legacy: process.argv.includes('--legacy'),
      webRoot: process.env.REMOTE_GIT_FIXTURE_WEB_ROOT || path.join(root, 'apps/web/dist'),
    }).then(({ origin }) => console.log(`Repository loading fixture: ${origin}`));
  }
}
