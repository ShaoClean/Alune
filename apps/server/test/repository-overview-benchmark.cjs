// Build shared, ssh-client, server and web first. All data/SSH credentials are disposable.
// node apps/server/test/repository-overview-benchmark.cjs [--serve]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), 'alune-overview-benchmark-'),
);
process.env.ALUNE_DATA_DIR = path.join(temp, 'data');
const { startServer } = require('../dist/bootstrap');
const { ConnectionService } = require('../dist/connection/connection.service');
const {
  startSSHServer,
} = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
(async () => {
  const ssh = await startSSHServer();
  const app = await startServer({
    port: 3138,
    webRoot: path.join(root, 'apps/web/dist'),
  });
  const database = app.get('DATABASE');
  const host = await app
    .get(ConnectionService)
    .create({ name: 'Benchmark SSH', authType: 'password', ...ssh.options });
  const seed = path.join(temp, 'seed');
  fs.mkdirSync(seed);
  const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
  git('-C', seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(
    path.join(seed, 'main.ts'),
    'export const fixture = true;\n',
  );
  git('-C', seed, 'add', '.');
  execFileSync(
    'git',
    [
      '-C',
      seed,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: new Date(Date.now() - 86400000).toISOString(),
        GIT_COMMITTER_DATE: new Date(Date.now() - 86400000).toISOString(),
      },
      stdio: 'pipe',
    },
  );
  const ids = [],
    rows = [],
    results = [];
  const insert = database.prepare(
    'INSERT INTO repositories (id,source,connection_id,name,path) VALUES (?,?,?,?,?)',
  );
  const summary = async (targets, collect) => {
    let requests = 0,
      bytes = 0,
      valid = 0;
    const start = performance.now();
    for (let i = 0; i < targets.length; i += 20) {
      const response = await fetch(
        'http://127.0.0.1:3138/api/repositories/analytics/summary',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', connection: 'close' },
          body: JSON.stringify({ ids: targets.slice(i, i + 20), collect }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const text = await response.text();
      bytes += Buffer.byteLength(text);
      requests++;
      const items = JSON.parse(text);
      valid += items.filter((item) => item.data && !item.error).length;
      if (collect && items.some((item) => item.error)) throw new Error(text);
    }
    return {
      ms: +(performance.now() - start).toFixed(1),
      requests,
      bytes,
      valid,
    };
  };
  for (const count of [0, 1, 20, 100, 500]) {
    while (ids.length < count) {
      const index = ids.length,
        repo = path.join(temp, `repo-${index}`),
        id = randomUUID();
      git('clone', '-q', '--shared', seed, repo);
      const row = [
        id,
        index % 2 ? 'ssh' : 'local',
        index % 2 ? host.id : null,
        `仓库 ${String(index).padStart(3, '0')}`,
        repo,
      ];
      insert.run(...row);
      ids.push(id);
      rows.push(row);
    }
    // Force genuinely cold collection at each size by clearing only this service's test-owned cache.
    const {
      RepositoryAnalyticsService,
    } = require('../dist/repository/repository-analytics.service');
    app.get(RepositoryAnalyticsService).cache.clear();
    const cold = await summary(ids, true),
      warm = await summary(ids, true),
      cached = await summary(ids, false);
    const row = {
      count,
      local: Math.ceil(count / 2),
      ssh: Math.floor(count / 2),
      cold,
      warm,
      cached,
    };
    results.push(row);
    console.log('BENCHMARK ' + JSON.stringify(row));
  }
  const report = {
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
    results,
  };
  fs.writeFileSync(
    path.join(temp, 'results.json'),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(path.join(temp, 'rows.json'), JSON.stringify(rows));
  console.log('BENCHMARK_DIR ' + temp);
  const cleanup = async () => {
    await app.close();
    await ssh.close();
    fs.rmSync(temp, { recursive: true, force: true });
  };
  if (process.argv.includes('--serve')) {
    console.log('BENCHMARK_READY http://localhost:3138');
    process.on('SIGINT', async () => {
      await cleanup();
      process.exit();
    });
    process.on('SIGTERM', async () => {
      await cleanup();
      process.exit();
    });
  } else await cleanup();
})().catch((error) => {
  console.error(error);
  fs.rmSync(temp, { recursive: true, force: true });
  process.exit(1);
});
