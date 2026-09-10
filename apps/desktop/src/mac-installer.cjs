const { execFile, spawn } = require('node:child_process');
const { constants } = require('node:fs');
const { access, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, rmdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

// Run outside the app bundle: replacing the bundle must wait until Electron exits.
// All paths are positional arguments, never interpolated into shell source.
const installScript = String.raw`#!/bin/sh
set -u
umask 077
parent_pid="$1"
target="$2"
stage_dir="$3"
status_file="$4"
launcher="$5"
remaining="$6"
new_app="$stage_dir/RemoteGit.app"
backup="$stage_dir/Previous.app"
report() { printf '%s\n%s\n' "$1" "$stage_dir" > "$status_file"; }
cleanup() { /bin/rm -rf "$stage_dir"; }
move() {
  if [ -e "$2" ] || [ -L "$2" ]; then return 1; fi
  /bin/mv "$1" "$2"
}
restore() {
  if [ -e "$target" ]; then
    move "$target" "$new_app" || return 1
  fi
  move "$backup" "$target"
}
if [ ! -d "$new_app" ] || [ ! -d "$target" ] || [ -e "$backup" ]; then exit 1; fi
printf 'ready\n'
exec 1>&-
while kill -0 "$parent_pid" 2>/dev/null; do
  if [ "$remaining" -le 0 ]; then report quit-timeout; cleanup; exit 1; fi
  remaining=$((remaining - 1))
  /bin/sleep 1
done
if ! move "$target" "$backup"; then
  report replace-failed
  "$launcher" -n "$target"
  cleanup
  exit 1
fi
if ! move "$new_app" "$target"; then
  if restore; then
    report replace-failed
    "$launcher" -n "$target"
    cleanup
  else
    report rollback-failed
  fi
  exit 1
fi
if ! "$launcher" -n "$target"; then
  if restore; then
    report launch-failed
    "$launcher" -n "$target"
    cleanup
  else
    report rollback-failed
  fi
  exit 1
fi
cleanup
`;

function appBundlePath(executable) {
  const macOS = path.dirname(executable);
  const contents = path.dirname(macOS);
  const bundle = path.dirname(contents);
  if (path.basename(macOS) !== 'MacOS' || path.basename(contents) !== 'Contents' || !bundle.endsWith('.app')) {
    throw new Error('无法定位当前应用，请从已安装的 RemoteGit.app 中重试更新。');
  }
  return bundle;
}

function createMacInstaller({ appBundle, cacheDir, arch, bundleId = 'com.remotegit.desktop',
  run = promisify(execFile), spawnImpl = spawn, parentPid = process.pid, launcher = '/usr/bin/open', quitTimeout = 60 }) {
  const command = (file, args) => run(file, args, { timeout: 120000, maxBuffer: 1024 * 1024 });

  async function validateBundle(bundle, version) {
    if (!(await lstat(bundle)).isDirectory()) throw new Error('更新包中的 RemoteGit.app 无效。');
    const info = path.join(bundle, 'Contents/Info.plist');
    const metadata = JSON.parse((await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info])).stdout);
    if (metadata.CFBundleIdentifier !== bundleId || metadata.CFBundleShortVersionString !== version
      || metadata.CFBundleExecutable !== 'RemoteGit') throw new Error('更新包中的应用标识或版本不匹配。');
    const executable = path.join(bundle, 'Contents/MacOS/RemoteGit');
    const resolved = await realpath(executable);
    if (!resolved.startsWith(`${await realpath(bundle)}${path.sep}`)) throw new Error('更新包中的应用路径无效。');
    await access(executable, constants.X_OK);
    // `file` ships with macOS; `lipo` would require users to install developer tools.
    const description = (await command('/usr/bin/file', ['-b', executable])).stdout;
    const architecture = arch === 'x64' ? 'x86_64' : 'arm64';
    if (!new RegExp(`Mach-O 64-bit executable ${architecture}(?:\\s|\\]|$)`).test(description)) {
      throw new Error('更新包中的应用架构不匹配。');
    }
  }

  return {
    async prepare(file, version) {
      const target = await realpath(appBundle);
      if (target.startsWith('/Volumes/') || target.includes('/AppTranslocation/')) {
        throw new Error('请先将 RemoteGit 移到“应用程序”或其他可写目录，再重启安装更新。');
      }
      let stageDir;
      try { stageDir = await mkdtemp(path.join(path.dirname(target), '.RemoteGit-update-')); }
      catch (error) {
        if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) {
          throw new Error('当前应用目录不可写，请将 RemoteGit 移到个人“应用程序”目录后重试。');
        }
        throw error;
      }
      let handedOff = false;
      const dispose = async () => { if (!handedOff) await rm(stageDir, { recursive: true, force: true }); };
      try {
        await mkdir(cacheDir, { recursive: true, mode: 0o700 });
        const mountPoint = await mkdtemp(path.join(cacheDir, 'mount-'));
        let mounted = false;
        try {
          await command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, file]);
          mounted = true;
          const source = path.join(mountPoint, 'RemoteGit.app');
          await validateBundle(source, version);
          const stagedApp = path.join(stageDir, 'RemoteGit.app');
          await command('/usr/bin/ditto', [source, stagedApp]);
          await validateBundle(stagedApp, version);
        } finally {
          // An attach that timed out may still have mounted the image. Never recurse
          // into the mount point, and keep it intact if detaching a mounted image fails.
          try { await command('/usr/bin/hdiutil', ['detach', mountPoint]); }
          catch (error) { if (mounted) throw error; }
          await rmdir(mountPoint);
        }
        const script = path.join(stageDir, 'install.sh');
        await writeFile(script, installScript, { mode: 0o700 });
        return { target, stageDir, script, dispose, handOff: () => { handedOff = true; } };
      } catch (error) {
        await dispose();
        throw error;
      }
    },

    async install(prepared) {
      const statusFile = path.join(cacheDir, 'install-result');
      await rm(statusFile, { force: true });
      const log = await open(path.join(cacheDir, 'install.log'), 'w', 0o600);
      let child;
      try {
        child = spawnImpl('/bin/sh', [prepared.script, String(parentPid), prepared.target, prepared.stageDir,
          statusFile, launcher, String(quitTimeout)], {
          detached: true, cwd: cacheDir, stdio: ['ignore', 'pipe', log.fd],
        });
        await new Promise((resolve, reject) => {
          let output = '';
          const finish = (error) => {
            clearTimeout(timer);
            child.off('error', failed);
            child.off('exit', exited);
            child.stdout.off('data', ready);
            if (error) reject(error); else resolve();
          };
          const failed = (error) => finish(error);
          const exited = () => finish(new Error('更新安装程序未能启动，请重试。'));
          const ready = (data) => { output += data.toString(); if (output.includes('ready\n')) finish(); };
          const timer = setTimeout(() => finish(new Error('启动更新安装程序超时，请重试。')), 5000);
          child.once('error', failed);
          child.once('exit', exited);
          child.stdout.on('data', ready);
        });
        prepared.handOff();
        child.stdout.destroy();
        child.unref();
        return child;
      } catch (error) {
        child?.kill();
        throw error;
      } finally { await log.close(); }
    },
  };
}

async function takeInstallError(cacheDir) {
  const file = path.join(cacheDir, 'install-result');
  let result;
  try { result = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  await rm(file, { force: true });
  const [code, stageDir] = result.trimEnd().split('\n');
  const messages = {
    'quit-timeout': '应用未能及时退出，已取消更新。请重新启动应用后重试。',
    'replace-failed': '未能替换应用，已保留原版本。请检查应用目录权限后重试。',
    'launch-failed': '新版本未能启动，已恢复原版本。请重新检查更新后重试。',
    'rollback-failed': `更新未完成，原应用备份保留在 ${stageDir}。请从备份恢复应用。`,
  };
  return messages[code] || '上次更新未完成，请重新检查更新后重试。';
}

module.exports = { createMacInstaller, appBundlePath, takeInstallError };
