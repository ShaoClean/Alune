// Run on disposable GitHub-hosted workers only. NSIS records a per-user
// installation, so this drill must never target a developer's desktop account.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { withInstalledWindow, oldApi } from './installed-v011.mjs';
import os from 'node:os';
import { verifyLiveUpdate } from './update-drill.mjs';
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
  !process.env.RUNNER_TEMP
)
  throw Error('A disposable GitHub-hosted worker is required for the installer drill');
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'alune-install-'));
const desktop = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(desktop, '../../package.json'))).version;
const previous = '0.11.0';
const platform =
  process.platform === 'darwin'
    ? 'mac-' + process.arch + '.dmg'
    : process.platform === 'win32'
      ? 'win-x64.exe'
      : 'linux-x86_64.AppImage';
const name = (v) => 'Alune-' + v + '-' + platform;
const appData =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? process.env.APPDATA
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
const data = path.join(appData, 'Alune'),
  old = path.join(root, 'release'),
  target = path.join(root, 'installed');
if (fs.existsSync(data)) throw Error('Installer drill refuses an existing desktop profile');
for (const d of [old, target]) fs.mkdirSync(d, { mode: 0o700 });
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', timeout: 300000, ...options });
}
async function install(file) {
  if (process.platform === 'win32') {
    run(file, ['/currentuser', '/S', '/D=' + target]);
    return path.join(target, 'Alune.exe');
  }
  if (process.platform === 'linux') {
    fs.chmodSync(file, 0o755);
    fs.rmSync(path.join(target, 'squashfs-root'), { recursive: true, force: true });
    run(file, ['--appimage-extract'], { cwd: target, stdio: 'ignore' });
    return path.join(target, 'squashfs-root', 'alune');
  }
  const mount = fs.mkdtempSync(path.join(root, 'mount-'));
  run('/usr/bin/hdiutil', [
    'attach',
    '-nobrowse',
    '-readonly',
    '-noautoopen',
    '-mountpoint',
    mount,
    file,
  ]);
  try {
    fs.rmSync(path.join(target, 'Alune.app'), { recursive: true, force: true });
    run('/usr/bin/ditto', [path.join(mount, 'Alune.app'), path.join(target, 'Alune.app')]);
  } finally {
    run('/usr/bin/hdiutil', ['detach', mount]);
  }
  return path.join(target, 'Alune.app', 'Contents', 'MacOS', 'Alune');
}
async function boot(exe, phase, fixture) {
  const child = spawn(exe, ['--smoke-test'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ALUNE_SMOKE_DIR: data,
      ALUNE_SMOKE_PHASE: phase,
      ...(fixture ? { ALUNE_CANDIDATE_FIXTURE: JSON.stringify(fixture) } : {}),
    },
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 240000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw Error('Installed desktop ' + phase + ' failed: ' + code);
  } finally {
    clearTimeout(timeout);
  }
}
const previousFile = path.join(old, name(previous)),
  candidateFile = path.join(desktop, 'release', name(version));
try {
  run('gh', [
    'release',
    'download',
    'v' + previous,
    '--repo',
    'ShaoClean/Alune',
    '--pattern',
    name(previous),
    '--pattern',
    'SHA256SUMS',
    '--dir',
    old,
  ]);
  const record = fs
    .readFileSync(path.join(old, 'SHA256SUMS'), 'utf8')
    .split(/\r?\n/)
    .find((row) => row.trim().endsWith(' ' + name(previous)));
  if (!record || record.split(/\s/)[0] !== digest(previousFile))
    throw Error('Published installer checksum mismatch');
  const repo = path.join(root, 'upgrade-repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Upgrade');
  git('config', 'user.email', 'upgrade@example.invalid');
  fs.writeFileSync(path.join(repo, 'candidate.txt'), 'original\n');
  git('add', 'candidate.txt');
  git('-c', 'commit.gpgSign=false', 'commit', '-qm', 'upgrade fixture');
  fs.writeFileSync(path.join(repo, 'candidate.txt'), 'changed in legacy workspace\n');
  const fixture = await withInstalledWindow(await install(previousFile), async (evaluate) => {
    const created = await oldApi(evaluate, 'POST', 'repositories', { source: 'local', path: repo });
    const proxy = await oldApi(evaluate, 'GET', 'network-proxy');
    await oldApi(evaluate, 'PUT', 'network-proxy', {
      revision: proxy.revision,
      enabled: false,
      authEnabled: false,
      protocol: 'http',
      host: '127.0.0.1',
      port: 18291,
      credentials: { action: 'clear' },
    });
    const tokens = await oldApi(evaluate, 'GET', 'access-tokens');
    let tokenId = null;
    if (tokens.secretStorage.available) {
      const result = await oldApi(evaluate, 'POST', 'access-tokens', {
        revision: tokens.revision,
        name: 'Upgrade fixture token',
        value: 'isolated-upgrade-test-token',
      });
      tokenId = result.tokens[0].id;
    }
    const prefs = {
      version: 1,
      state: {
        repositorySession: { ids: [created.id], activeId: created.id },
        appearance: { theme: 'dark', reduceMotion: true },
        repositoryOrderByConnection: { '@local': [created.id] },
      },
    };
    await evaluate('window.aluneWorkspace.save(' + JSON.stringify(JSON.stringify(prefs)) + ')');
    return { id: created.id, repo, tokenId, fromRelease: true };
  });
  if (!fs.existsSync(path.join(data, 'alune.db')))
    throw Error('Published desktop did not create its isolated profile');
  // Snapshot with the process stopped. Include SQLite WAL/SHM if present.
  const restorePoint = path.join(root, 'pre-upgrade');
  fs.mkdirSync(restorePoint, { mode: 0o700 });
  const originals = [
    'alune.db',
    'Local State',
    'alune.db-wal',
    'alune.db-shm',
    'workspace.json',
    'network-proxy.json',
    'ai-settings.json',
    'logging.json',
    'ai-master-key',
  ];
  for (const file of originals)
    if (fs.existsSync(path.join(data, file)))
      fs.copyFileSync(path.join(data, file), path.join(restorePoint, file));
  fixture.db = digest(path.join(data, 'alune.db'));
  fixture.workspace = digest(path.join(data, 'workspace.json'));
  if (process.platform === 'win32' && fixture.tokenId) {
    const state = JSON.parse(fs.readFileSync(path.join(data, 'Local State'), 'utf8'));
    if (!state.os_crypt?.encrypted_key)
      throw Error('Published application did not persist its DPAPI master-key descriptor');
  }
  const exe = await install(candidateFile);
  if (
    process.platform === 'win32' &&
    fixture.tokenId &&
    digest(path.join(data, 'Local State')) !== digest(path.join(restorePoint, 'Local State'))
  )
    throw Error('Installer changed the original Chromium Local State before migration');
  await boot(exe, 'write', fixture);
  await boot(exe, 'restore', fixture);
  const gitFacts = () =>
    JSON.stringify({
      head: git('rev-parse', 'HEAD'),
      refs: git('for-each-ref', '--format=%(refname) %(objectname)'),
      index: git('ls-files', '--stage', '-z'),
      worktree: digest(path.join(repo, 'candidate.txt')),
    });
  const beforeRollback = gitFacts();
  for (const file of originals) {
    const backup = path.join(restorePoint, file);
    if (fs.existsSync(backup)) fs.copyFileSync(backup, path.join(data, file));
    else fs.rmSync(path.join(data, file), { force: true });
  }
  await withInstalledWindow(await install(previousFile), async (evaluate) => {
    const r = await oldApi(evaluate, 'GET', 'repositories/' + fixture.id),
      p = await oldApi(evaluate, 'GET', 'network-proxy');
    if (r.id !== fixture.id || p.port !== 18291)
      throw Error('Released desktop did not recover original registration/settings');
    const pref = JSON.parse(await evaluate('window.aluneWorkspace.load()'));
    if (!pref.state.repositorySession.ids.includes(fixture.id))
      throw Error('Released desktop lost the saved tab');
    if (
      fixture.tokenId &&
      !(await oldApi(evaluate, 'GET', 'access-tokens')).tokens.some((t) => t.id === fixture.tokenId)
    )
      throw Error('Released desktop lost token metadata');
  });
  if (
    gitFacts() !== beforeRollback ||
    fs.readFileSync(path.join(repo, 'candidate.txt'), 'utf8') !== 'changed in legacy workspace\n'
  )
    throw Error('Application rollback changed Git data');
  const stable = process.env.ALUNE_VALIDATION_STABLE;
  if (!stable || version !== stable + '-rc.1')
    throw Error('Actual update target must match the private test build');
  let stableDigest = digest(previousFile);
  if (stable !== previous) {
    const latest = fs.mkdtempSync(path.join(root, 'checksums-'));
    run('gh', [
      'release',
      'download',
      'v' + stable,
      '--repo',
      'ShaoClean/Alune',
      '--pattern',
      'SHA256SUMS',
      '--dir',
      latest,
    ]);
    const checksum = fs
      .readFileSync(path.join(latest, 'SHA256SUMS'), 'utf8')
      .split(/\r?\n/)
      .find((s) => s.trim().endsWith(' ' + name(stable)))
      ?.split(/\s/)[0];
    if (!/^[a-f0-9]{64}$/.test(checksum ?? ''))
      throw Error('Stable release installer checksum missing');
    stableDigest = checksum;
  }
  await verifyLiveUpdate({
    exe: await install(candidateFile),
    candidateFile,
    target,
    data,
    stable,
    stableDigest,
  });
  console.log(
    JSON.stringify({
      platform,
      old: previous,
      candidate: version,
      oldSha256: digest(previousFile),
      candidateSha256: digest(candidateFile),
      upgrade: true,
      rollback: true,
    }),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
