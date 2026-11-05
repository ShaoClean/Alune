// Measures the current production HTTP/Socket.IO path in disposable repositories.
// Cold means a fresh application process, NOT a flushed operating-system cache.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ALUNE_BASELINE_SOURCE_ROOT || root;
const readsOnly = process.env.ALUNE_BASELINE_READS_ONLY === '1';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A common core-HTTP caller keeps cold measurements independent of whether the
// application happened to initialize fetch/Undici while loading its own services.
// First-request socket setup and response decoding remain inside the timer.
function readHttp(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = require('node:http').get(
      url,
      { headers, signal: AbortSignal.timeout(30000) },
      (response) => {
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 32 * 1024 * 1024)
            response.destroy(new Error('Benchmark response exceeded budget'));
        });
        response.once('error', reject);
        response.once('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300)
            return reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          try {
            resolve(
              response.headers['content-type']?.includes('application/json')
                ? JSON.parse(body)
                : body,
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once('error', reject);
  });
}

async function worker() {
  const [repo, count, data] = process.argv.slice(3);
  process.env.ALUNE_DATA_DIR = data;
  process.env.SHELL = '/bin/sh';
  process.env.PS1 = 'ALUNE_BASELINE> ';
  const { startServer } = require(path.join(sourceRoot, 'apps/server/dist/bootstrap'));
  const { RepositoryService } = require(
    path.join(sourceRoot, 'apps/server/dist/repository/repository.service'),
  );
  const { io } = require('socket.io-client');
  const token = randomUUID();
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    token,
    webRoot: path.join(root, 'apps/web/dist'),
  });
  let socket;
  const stop = async () => {
    socket?.disconnect();
    await app.close();
    process.exit(1);
  };
  process.once('SIGTERM', stop);
  try {
    const record = await app.get(RepositoryService).addLocal(repo);
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const get = (suffix) =>
      readHttp(`${base}/api/repositories/${record.id}/${suffix}`, {
        Authorization: `Bearer ${token}`,
      });
    const states = new Map();
    const outputs = new Map();
    if (!readsOnly) {
      socket = io(base + '/terminal', {
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { Authorization: `Bearer ${token}` },
      });
      socket.on('terminal:state', (state) => states.set(state.id, state));
      socket.on('terminal:output', (packet) => {
        outputs.set(packet.sessionId, (outputs.get(packet.sessionId) || '') + packet.data);
        socket.emit('terminal:ack', { sessionId: packet.sessionId, sequence: packet.sequence });
      });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
    }
    const request = async (name, body) => {
      const reply = await socket.timeout(10000).emitWithAck('terminal:' + name, body);
      if (!reply.ok) throw new Error(reply.error);
      return reply.value;
    };
    const until = async (check) => {
      const started = performance.now();
      while (!check()) {
        if (performance.now() - started > 10000) throw new Error('PTY benchmark timed out');
        await delay(1);
      }
    };
    const rows = [];
    for (let i = 0; i < Number(count); i++) {
      const row = {};
      for (const [name, suffix] of [
        ['status', 'status?foreground=true'],
        ['diff', 'diff?file=tracked.txt'],
        ['history', 'log?limit=50'],
      ]) {
        const start = performance.now();
        const result = await get(suffix);
        row[name] = performance.now() - start;
        // Guard against a successful response returning no useful fixture data.
        if (
          result == null ||
          (name === 'status' && !result.files?.some((file) => file.path === 'tracked.txt')) ||
          (name === 'history' && result.commits?.length !== 50) ||
          (name === 'diff' && !JSON.stringify(result).includes('modified'))
        ) {
          throw new Error(`Invalid ${name} fixture response`);
        }
      }
      if (!readsOnly) {
        const id = randomUUID();
        await request('create', { requestId: id, repositoryId: record.id, cols: 80, rows: 24 });
        await until(() => states.get(id)?.state === 'running');
        const start = performance.now();
        await request('input', {
          sessionId: id,
          data: `${JSON.stringify(process.execPath)} -e "process.stdout.write('X'.repeat(65536)+'\\nALUNE_BENCH_DONE\\n')"\r`,
        });
        await until(() => (outputs.get(id) || '').includes('\r\nALUNE_BENCH_DONE\r\n'));
        row.terminalOutput = performance.now() - start;
        if ((outputs.get(id).match(/X/g) || []).length < 65536)
          throw new Error('Truncated PTY output');
        await request('close', { sessionId: id, confirmed: true });
        outputs.delete(id);
        states.delete(id);
      }
      rows.push(row);
    }
    process.send({ rows, nodeMaxRssKiB: process.resourceUsage().maxRSS });
  } finally {
    process.removeListener('SIGTERM', stop);
    socket?.disconnect();
    await app.close();
  }
}

// Same HTTP request boundary as P0, with only a thin query bridge in the caller.
// The measured descendant set includes the real standalone Agent process.
async function agentReadWorker() {
  if (!readsOnly) throw new Error('Agent P3 measurements require ALUNE_BASELINE_READS_ONLY=1');
  const [repo, count, data] = process.argv.slice(3);
  const { createServer } = require('node:http');
  const { spawnAgent } = require('../packages/agent-client/dist/node');
  const agent = spawnAgent(process.execPath, [
    path.join(root, 'packages/agent/bin/alune-agent.cjs'),
    'serve',
    '--data-dir',
    data,
  ]);
  let server;
  const stop = async () => {
    await agent.close();
    server?.close();
    process.exit(1);
  };
  process.once('SIGTERM', stop);
  try {
    await agent.client.initialize();
    const registered = await agent.client.registerRepository(repo);
    const routes = {
      status: ['status', { foreground: true }],
      diff: ['diff', { file: 'tracked.txt' }],
      log: ['log', { count: 50 }],
    };
    server = createServer(async (req, res) => {
      try {
        const name = new URL(req.url, 'http://localhost').pathname.split('/').at(-1);
        const route = routes[name];
        if (!route) {
          res.writeHead(404).end();
          return;
        }
        const result = await agent.client.readRepository(registered.resource, route[0], route[1]);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/repositories/${registered.id}`;
    const rows = [];
    for (let i = 0; i < Number(count); i++) {
      const row = {};
      for (const [name, suffix] of [
        ['status', 'status?foreground=true'],
        ['diff', 'diff?file=tracked.txt'],
        ['history', 'log?limit=50'],
      ]) {
        const start = performance.now();
        const result = await readHttp(`${base}/${suffix}`);
        row[name] = performance.now() - start;
        if (
          result == null ||
          (name === 'status' && !result.files?.some((f) => f.path === 'tracked.txt')) ||
          (name === 'history' && result.commits?.length !== 50) ||
          (name === 'diff' && !result.includes('modified'))
        )
          throw new Error(`Invalid ${name} fixture response`);
      }
      rows.push(row);
    }
    process.send({ rows, nodeMaxRssKiB: process.resourceUsage().maxRSS });
  } finally {
    process.removeListener('SIGTERM', stop);
    if (server) await new Promise((resolve) => server.close(resolve));
    await agent.close();
  }
}

function processTable() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
}
async function runWorker(repo, count, data) {
  const child = fork(__filename, ['--worker', repo, String(count), data], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: process.env,
  });
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors = (errors + chunk).slice(-8000);
  });
  let result;
  const seen = new Set([child.pid]);
  let peakRssKiB = 0;
  let peakProcesses = 0;
  const sample = () => {
    const table = processTable();
    const active = new Set([child.pid]);
    let added;
    do {
      added = false;
      for (const [pid, ppid] of table)
        if (active.has(ppid) && !active.has(pid)) {
          active.add(pid);
          seen.add(pid);
          added = true;
        }
    } while (added);
    const members = table.filter(([pid]) => active.has(pid));
    peakRssKiB = Math.max(
      peakRssKiB,
      members.reduce((sum, row) => sum + row[2], 0),
    );
    peakProcesses = Math.max(peakProcesses, members.length);
  };
  const monitor = setInterval(sample, 25);
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
  try {
    await new Promise((resolve, reject) => {
      child.on('message', (message) => {
        result = message;
      });
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`Worker ${code ?? signal}: ${errors}`)),
      );
    });
    if (!result) throw new Error('Worker returned no measurements');
    await delay(100);
    const remaining = processTable()
      .filter(([pid]) => seen.has(pid))
      .map(([pid]) => pid);
    return { ...result, peakRssKiB, peakProcesses, remainingProcesses: remaining };
  } finally {
    clearInterval(monitor);
    clearTimeout(timeout);
  }
}

async function main() {
  if (process.platform === 'win32')
    throw new Error(
      'This POSIX baseline harness requires ps and /bin/sh; Windows measurements remain a separate gate.',
    );
  const samples = Number(process.argv[2] || 20);
  if (!Number.isInteger(samples) || samples < 2 || samples > 100)
    throw new Error('samples must be 2–100');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-baseline-'));
  const config = path.join(temp, 'gitconfig');
  fs.writeFileSync(config, '');
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  const results = [];
  let lfsVersion = null;
  try {
    lfsVersion = execFileSync('git', ['lfs', 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {}
  try {
    const profiles = [
      ['small', 20, 0],
      ['many-files', 5000, 0],
      ['large-file', 20, 64],
    ];
    if (lfsVersion) profiles.push(['lfs', 20, 64]);
    for (const [name, files, largeMiB] of profiles) {
      const repo = path.join(temp, name);
      fs.mkdirSync(repo);
      const git = (...args) =>
        execFileSync('git', ['-C', repo, ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'Baseline');
      git('config', 'user.email', 'fixture@example.invalid');
      git('config', 'commit.gpgSign', 'false');
      git('config', 'core.hooksPath', '.git/hooks');
      if (name === 'lfs') {
        git('lfs', 'install', '--local');
        git('lfs', 'track', '*.bin');
      }
      for (let i = 0; i < files; i++)
        fs.writeFileSync(path.join(repo, `file-${i}.txt`), `fixture ${i}\n`);
      if (largeMiB)
        fs.writeFileSync(path.join(repo, 'large.bin'), Buffer.alloc(largeMiB * 1024 * 1024, 42));
      fs.writeFileSync(path.join(repo, 'tracked.txt'), 'baseline\n');
      git('add', '.');
      git('commit', '-qm', 'fixture');
      for (let i = 0; i < 60; i++) git('commit', '-q', '--allow-empty', '-m', `history ${i}`);
      fs.appendFileSync(path.join(repo, 'tracked.txt'), 'modified\n');
      if (largeMiB) {
        const fd = fs.openSync(path.join(repo, 'large.bin'), 'r+');
        fs.writeSync(fd, Buffer.from('modified'), 0, 8, 1024);
        fs.closeSync(fd);
      }
      const cold = [];
      for (let i = 0; i < samples; i++)
        cold.push(await runWorker(repo, 1, path.join(temp, `${name}-cold-${i}`)));
      const warm = await runWorker(repo, samples + 1, path.join(temp, `${name}-warm`));
      warm.rows.shift(); // Warm-up request excluded, resource high-water mark still includes startup.
      const summarize = (rows) =>
        Object.fromEntries(
          Object.keys(rows[0]).map((key) => {
            const values = rows.map((row) => row[key]).sort((a, b) => a - b);
            return [
              key,
              {
                p50Ms: values[Math.ceil(values.length * 0.5) - 1],
                p95Ms: values[Math.ceil(values.length * 0.95) - 1],
              },
            ];
          }),
        );
      results.push({
        name,
        files: files + 1 + Boolean(largeMiB) + (name === 'lfs'),
        largeMiB,
        commits: 61,
        cold,
        warm,
        summary: { cold: summarize(cold.flatMap((item) => item.rows)), warm: summarize(warm.rows) },
      });
      console.error(`Measured ${name}`);
    }
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
          implementationSha:
            process.env.ALUNE_BASELINE_SOURCE_SHA ||
            (sourceRoot === root
              ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
              : null),
          dirty: Boolean(
            execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
          ),
          platform: process.platform,
          arch: process.arch,
          osRelease: os.release(),
          node: process.version,
          lfsVersion,
          samples,
          methodology: {
            cold: 'fresh application process; OS page cache NOT flushed',
            warm: 'same process, one warm-up excluded',
            transport:
              process.env.ALUNE_BASELINE_UI === '1'
                ? 'production UI host IPC / Agent Client, no Chromium render or preload hop'
                : process.env.ALUNE_BASELINE_AGENT_READS === '1'
                  ? 'HTTP read bridge + production stdio Agent, loopback'
                  : readsOnly
                    ? 'production HTTP, loopback, local repository'
                    : 'production HTTP + Socket.IO, loopback, local repository',
            caller:
              process.env.ALUNE_BASELINE_UI === '1'
                ? 'Agent Client via parent/child IPC; same Git fixtures and PTY payload'
                : 'node:http; fresh first-request socket, response decoding timed identically',
            sourceRoot: sourceRoot === root ? 'current checkout' : 'frozen baseline checkout',
            memory:
              '25ms sampled aggregate RSS of application worker and observed descendants; includes startup; may miss short-lived peaks',
            processes:
              '25ms observed descendants; remaining PIDs checked 100ms after exit; short-lived/orphan races can be missed',
            terminal:
              'input to receipt of 64 KiB output plus sentinel; includes Node command startup; 1ms polling',
            limitations: [
              ...(lfsVersion ? [] : ['LFS profile skipped: git-lfs unavailable']),
              'No SSH performance measured',
              'No OS-cold cache claim',
              'No UI rendering timing',
            ],
          },
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

(process.argv[2] === '--worker'
  ? process.env.ALUNE_BASELINE_UI === '1'
    ? require('./agent/ui-benchmark-worker.cjs')(...process.argv.slice(3))
    : process.env.ALUNE_BASELINE_AGENT_READS === '1'
      ? agentReadWorker()
      : worker()
  : main()
).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
