// Run on disposable GitHub-hosted workers only. NSIS records a per-user
// installation, so this drill must never target a developer's desktop account.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { legacyFixture } from './candidate-fixture.mjs';
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
const data = path.join(root, 'data'),
  old = path.join(root, 'release'),
  target = path.join(root, 'installed');
for (const d of [data, old, target]) fs.mkdirSync(d, { mode: 0o700 });
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
      ALUNE_DESKTOP_EXECUTOR: fixture ? 'agent' : 'legacy',
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
  await boot(await install(previousFile), 'write', null);
  // Seed a known dirty Git index case while retaining the actual old settings,
  // credentials, SSH registrations and repository ordering from its executable.
  const fixture = legacyFixture(data, { existing: true });
  const exe = await install(candidateFile);
  await boot(exe, 'write', fixture);
  await boot(exe, 'restore', fixture);
  // Run the released binary's own credential/AI/sidebar checks again. Its data
  // directory is the original source, never the Agent copy.
  await boot(await install(previousFile), 'restore', null);
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
