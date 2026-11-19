// The installer modifies the runner's user profile. Use a disposable hosted runner.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLiveUpdate } from './update-drill.mjs';

if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
  !process.env.RUNNER_TEMP
)
  throw Error('A disposable GitHub-hosted worker is required for the installer drill');

const desktop = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(desktop, '../../package.json'))).version;
const stable = process.env.ALUNE_VALIDATION_STABLE;
if (!stable || version !== stable + '-rc.1')
  throw Error('Actual update target must match the private test build');
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
const data = path.join(appData, 'Alune');
if (fs.existsSync(data)) throw Error('Installer drill refuses an existing desktop profile');

const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'alune-install-'));
const target = path.join(root, 'installed');
const candidateFile = path.join(desktop, 'release', name(version));
function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', timeout: 300000, ...options });
}
function install(file) {
  if (process.platform === 'win32') {
    run(file, ['/currentuser', '/S', '/D=' + target]);
    return path.join(target, 'Alune.exe');
  }
  if (process.platform === 'linux') {
    fs.chmodSync(file, 0o755);
    run(file, ['--appimage-extract'], { cwd: target, stdio: 'ignore' });
    return path.join(target, 'squashfs-root', 'alune');
  }
  const mount = fs.mkdtempSync(path.join(root, 'mount-'));
  run('/usr/bin/hdiutil', [
    'attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file,
  ]);
  try {
    run('/usr/bin/ditto', [path.join(mount, 'Alune.app'), path.join(target, 'Alune.app')]);
  } finally {
    run('/usr/bin/hdiutil', ['detach', mount]);
  }
  return path.join(target, 'Alune.app', 'Contents', 'MacOS', 'Alune');
}

try {
  fs.mkdirSync(target, { mode: 0o700 });
  run('gh', [
    'release', 'download', 'v' + stable, '--repo', 'ShaoClean/Alune',
    '--pattern', 'SHA256SUMS', '--dir', root,
  ]);
  const stableDigest = fs
    .readFileSync(path.join(root, 'SHA256SUMS'), 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(' ' + name(stable)))
    ?.split(/\s/)[0];
  if (!/^[a-f0-9]{64}$/.test(stableDigest ?? ''))
    throw Error('Stable release installer checksum missing');
  await verifyLiveUpdate({ exe: install(candidateFile), candidateFile, target, data, stable, stableDigest });
} finally {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
