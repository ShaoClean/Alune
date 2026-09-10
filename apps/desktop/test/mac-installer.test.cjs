const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { createMacInstaller, appBundlePath, takeInstallError } = require('../src/mac-installer.cjs');

const exec = promisify(execFile);
const exitCode = (child) => child.exitCode !== null || child.signalCode !== null
  ? Promise.resolve(child.exitCode) : new Promise((resolve) => child.once('exit', resolve));
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) { child.kill(); await exitCode(child); }
}
async function parentProcess(t) {
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => stop(parent));
  return parent;
}

async function fixture(t, { metadata = {}, binaryArch = 'arm64', failure, ...options } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'remote-git-install-test-')));
  const applications = path.join(root, "Applications ' $literal (test)");
  const target = path.join(applications, 'RemoteGit.app');
  const payload = path.join(root, 'payload', 'RemoteGit.app');
  const cacheDir = path.join(root, 'data', 'updates');
  await mkdir(target, { recursive: true });
  await mkdir(path.join(payload, 'Contents', 'MacOS'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(target, 'version'), 'old');
  await writeFile(path.join(payload, 'version'), 'new');
  await writeFile(path.join(root, 'data', 'preferences'), 'keep existing data');
  await writeFile(path.join(payload, 'Contents', 'Info.plist'), JSON.stringify({
    CFBundleIdentifier: 'com.remotegit.desktop', CFBundleShortVersionString: '1.1.0', CFBundleExecutable: 'RemoteGit', ...metadata,
  }));
  await writeFile(path.join(payload, 'Contents', 'MacOS', 'RemoteGit'), 'fixture', { mode: 0o755 });
  const launcher = path.join(root, 'launch.sh');
  await writeFile(launcher, '#!/bin/sh\ncat "$2/version" >> launched\nprintf "\\n" >> launched\n', { mode: 0o700 });
  const commands = [];
  const run = async (command, args) => {
    const name = path.basename(command);
    commands.push([name, ...args]);
    if (failure === name) throw new Error(`${name} failed`);
    if (name === 'hdiutil' && args[0] === 'attach') await cp(payload, path.join(args[args.indexOf('-mountpoint') + 1], 'RemoteGit.app'), { recursive: true });
    if (name === 'hdiutil' && args[0] === 'detach') await rm(path.join(args[1], 'RemoteGit.app'), { recursive: true, force: true });
    if (name === 'plutil') return { stdout: await readFile(args.at(-1), 'utf8') };
    if (name === 'file') return { stdout: `Mach-O 64-bit executable ${binaryArch}` };
    if (name === 'ditto') await cp(args[0], args[1], { recursive: true });
    return { stdout: '' };
  };
  const installer = createMacInstaller({ appBundle: target, cacheDir, arch: 'arm64', run, launcher, ...options });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, applications, target, payload, cacheDir, launcher, commands, installer };
}

test('locates only an installed macOS application bundle', () => {
  const executable = path.resolve('Applications/RemoteGit.app/Contents/MacOS/RemoteGit');
  assert.equal(appBundlePath(executable), path.resolve('Applications/RemoteGit.app'));
  assert.throws(() => appBundlePath(path.resolve('bin/electron')), /已安装/);
});

test('macOS prepares on the same filesystem, validates copied bundle and detaches the DMG', async (t) => {
  const { installer, applications, commands, target, cacheDir } = await fixture(t);
  const prepared = await installer.prepare('/verified.dmg', '1.1.0');
  assert.equal(path.dirname(prepared.stageDir), applications);
  assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'old');
  assert.equal(await readFile(path.join(prepared.stageDir, 'RemoteGit.app', 'version'), 'utf8'), 'new');
  assert.equal(commands.filter(([name]) => name === 'plutil').length, 2);
  assert.equal(commands.at(-1)[1], 'detach');
  assert.deepEqual(await readdir(cacheDir), []);
  await prepared.dispose();
  assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
});

test('macOS rejects wrong bundle identity, version, binary architecture and failed copy without altering the app', async (t) => {
  for (const options of [
    { metadata: { CFBundleIdentifier: 'com.example.other' } },
    { metadata: { CFBundleShortVersionString: '1.0.0' } },
    { binaryArch: 'x86_64' }, { failure: 'ditto' },
  ]) {
    const { installer, applications, commands, target, cacheDir } = await fixture(t, options);
    await assert.rejects(installer.prepare('/verified.dmg', '1.1.0'), /不匹配|failed/);
    assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'old');
    assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
    assert.equal(commands.at(-1)[1], 'detach');
    assert.deepEqual(await readdir(cacheDir), []);
  }
});

test('non-writable application directory is rejected before mounting or stopping the app', { skip: process.platform === 'win32' }, async (t) => {
  const { installer, applications, commands } = await fixture(t);
  await chmod(applications, 0o555);
  try { await assert.rejects(installer.prepare('/verified.dmg', '1.1.0'), /目录不可写/); }
  finally { await chmod(applications, 0o755); }
  assert.deepEqual(commands, []);
  assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
});

test('helper waits for the old process, replaces the bundle and relaunches with literal paths', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  const parent = await parentProcess(t);
  const { installer, target, root, applications, cacheDir } = await fixture(t, { parentPid: parent.pid });
  const prepared = await installer.prepare('/verified.dmg', '1.1.0');
  const child = await installer.install(prepared);
  const done = exitCode(child);
  t.after(() => stop(child));
  await prepared.dispose(); // Ownership now belongs to the detached helper.
  assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'old');
  assert.equal(await readFile(path.join(prepared.stageDir, 'RemoteGit.app', 'version'), 'utf8'), 'new');
  await stop(parent);
  assert.equal(await done, 0);
  assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(cacheDir, 'launched'), 'utf8'), 'new\n');
  assert.equal(await readFile(path.join(root, 'data', 'preferences'), 'utf8'), 'keep existing data');
  assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
  assert.equal(await takeInstallError(cacheDir), null);
});

test('helper restores and relaunches the old app when replacement or launch fails', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  for (const failure of ['replace', 'launch']) {
    const parent = await parentProcess(t);
    const { installer, target, launcher, applications, cacheDir } = await fixture(t, { parentPid: parent.pid });
    if (failure === 'launch') await writeFile(launcher,
      '#!/bin/sh\nversion=$(cat "$2/version")\nprintf "%s\\n" "$version" >> launched\n[ "$version" = old ]\n', { mode: 0o700 });
    const prepared = await installer.prepare('/verified.dmg', '1.1.0');
    const child = await installer.install(prepared);
    const done = exitCode(child);
    t.after(() => stop(child));
    // Inject a disk failure after readiness but before replacement.
    if (failure === 'replace') await rm(path.join(prepared.stageDir, 'RemoteGit.app'), { recursive: true });
    await stop(parent);
    assert.equal(await done, 1);
    assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'old');
    assert.equal(await readFile(path.join(cacheDir, 'launched'), 'utf8'), failure === 'launch' ? 'new\nold\n' : 'old\n');
    assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
    assert.match(await takeInstallError(cacheDir), /原版本/);
    assert.equal(await takeInstallError(cacheDir), null);
  }
});

test('quit timeout preserves the running app and cleans the staged update', { skip: process.platform === 'win32', timeout: 10000 }, async (t) => {
  const { installer, target, applications, cacheDir } = await fixture(t, { quitTimeout: 0 });
  const prepared = await installer.prepare('/verified.dmg', '1.1.0');
  const child = await installer.install(prepared);
  assert.equal(await exitCode(child), 1);
  assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'old');
  assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
  assert.match(await takeInstallError(cacheDir), /未能及时退出/);
});

test('failed rollback retains the original backup and reports its recovery location', { skip: process.platform === 'win32', timeout: 15000 }, async (t) => {
  const parent = await parentProcess(t);
  const { installer, launcher, cacheDir } = await fixture(t, { parentPid: parent.pid });
  const prepared = await installer.prepare('/verified.dmg', '1.1.0');
  await writeFile(path.join(cacheDir, 'block-restore-path'), path.join(prepared.stageDir, 'RemoteGit.app'));
  await writeFile(launcher, '#!/bin/sh\nmkdir "$(cat block-restore-path)"\nexit 1\n', { mode: 0o700 });
  const child = await installer.install(prepared);
  const done = exitCode(child);
  t.after(() => stop(child));
  await stop(parent);
  assert.equal(await done, 1);
  assert.equal(await readFile(path.join(prepared.stageDir, 'Previous.app', 'version'), 'utf8'), 'old');
  assert.ok((await takeInstallError(cacheDir)).includes(prepared.stageDir));
});

test('failed helper startup leaves the app intact and the staged update can be disposed', async (t) => {
  const { installer, target, applications } = await fixture(t, { spawnImpl: () => { throw new Error('spawn denied'); } });
  const prepared = await installer.prepare('/verified.dmg', '1.1.0');
  await assert.rejects(installer.install(prepared), /spawn denied/);
  await prepared.dispose();
  assert.equal(await readFile(path.join(target, 'version'), 'utf8'), 'old');
  assert.deepEqual(await readdir(applications), ['RemoteGit.app']);
});

test('macOS native DMG staging, replacement and open launch upgrade an isolated app from 1.0.0 to 1.1.0',
  { skip: process.platform !== 'darwin', timeout: 60000 }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'remote-git-native-upgrade-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = path.join(root, 'Applications', 'RemoteGit.app');
    const payload = path.join(root, 'payload', 'RemoteGit.app');
    const cacheDir = path.join(root, 'data', 'updates');
    const marker = path.join(root, 'launched-version');
    const bundleId = `com.remotegit.upgrade-fixture.${process.pid}`;
    await mkdir(path.join(payload, 'Contents', 'MacOS'), { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    const plist = (version) => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
      <key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleShortVersionString</key><string>${version}</string>
      <key>CFBundleVersion</key><string>${version}</string><key>CFBundleExecutable</key><string>RemoteGit</string>
      <key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/>
    </dict></plist>`;
    await writeFile(path.join(payload, 'Contents', 'Info.plist'), plist('1.1.0'));
    const source = path.join(root, 'fixture.c');
    await writeFile(source, `#include <stdio.h>\n#include <unistd.h>\nint main(int argc, char **argv) {
      if (argc > 1) { while (1) pause(); }
      FILE *f = fopen(${JSON.stringify(marker)}, "w"); if (!f) return 1; fputs("1.1.0", f); fclose(f); return 0;
    }`);
    await exec('/usr/bin/clang', [source, '-o', path.join(payload, 'Contents', 'MacOS', 'RemoteGit')]);
    await cp(payload, target, { recursive: true });
    await writeFile(path.join(target, 'Contents', 'Info.plist'), plist('1.0.0'));
    await writeFile(path.join(root, 'data', 'preferences'), 'existing preferences');
    const dmg = path.join(root, 'update.dmg');
    await exec('/usr/bin/hdiutil', ['create', '-quiet', '-srcfolder', path.dirname(payload), '-format', 'UDZO', dmg], { timeout: 30000 });
    const parent = spawn(path.join(target, 'Contents', 'MacOS', 'RemoteGit'), ['--wait'], { stdio: 'ignore' });
    t.after(() => stop(parent));
    const installer = createMacInstaller({ appBundle: target, cacheDir, arch: process.arch, bundleId, parentPid: parent.pid });
    const prepared = await installer.prepare(dmg, '1.1.0');
    assert.match(await readFile(path.join(target, 'Contents', 'Info.plist'), 'utf8'), /1\.0\.0/);
    const child = await installer.install(prepared);
    const done = exitCode(child);
    t.after(() => stop(child));
    await stop(parent);
    assert.equal(await done, 0);
    for (let attempts = 0; attempts < 100; attempts++) {
      try { if (await readFile(marker, 'utf8') === '1.1.0') break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await readFile(marker, 'utf8'), '1.1.0');
    assert.match(await readFile(path.join(target, 'Contents', 'Info.plist'), 'utf8'), /1\.1\.0/);
    assert.equal(await readFile(path.join(root, 'data', 'preferences'), 'utf8'), 'existing preferences');
    assert.deepEqual(await readdir(path.dirname(target)), ['RemoteGit.app']);
  });
