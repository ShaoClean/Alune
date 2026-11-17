// A real released DMG and native launcher, with an explicit first-launch
// refusal. The replacement is never allowed to boot into a daily profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const exec = promisify(execFile), require = createRequire(import.meta.url);
const { createMacInstaller, takeInstallError } = require('../src/mac-installer.cjs');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const [dmgArg, outArg] = process.argv.slice(2);
if (!outArg || process.argv.length !== 4) throw Error('Usage: critical-native-rollback.mjs RELEASED_V011_DMG NEW_OUTPUT');
const dmg = await fs.realpath(dmgArg), out = path.resolve(outArg);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await fs.readFile(dmg)), 'c12e18d92c1b901645f274ef7e73dd052249a0f1f64f26faf5f59cf98761a554');
await fs.mkdir(out, { mode: 0o700 });
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'alune-critical-rollback-')));
const target = path.join(root, "Applications ' $literal", 'Alune.app'), cacheDir = path.join(root, 'profile/updates');
const marker = path.join(root, 'old-app-started.json');
const inputHashes = Object.fromEntries(await Promise.all(['mac-installer.cjs', '../scripts/critical-native-rollback.mjs'].map(async file => [file, hash(await fs.readFile(new URL('../src/' + file, import.meta.url)))])));
let parent, helper, prepared, failure, passed = false, statusMessage;
const exited = child => {
  child.ref();
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise(resolve => child.once('exit', resolve));
};
async function stop(child) { if (child && child.exitCode === null && child.signalCode === null) { const done = exited(child); child.kill('SIGTERM'); await done; } }
try {
  await fs.mkdir(path.join(target, 'Contents/MacOS'), { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.alune.desktop</string><key>CFBundleShortVersionString</key><string>0.10.0</string><key>CFBundleVersion</key><string>0.10.0</string><key>CFBundleExecutable</key><string>Alune</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>`;
  await fs.writeFile(path.join(target, 'Contents/Info.plist'), plist);
  const c = path.join(root, 'old.c'), binary = path.join(target, 'Contents/MacOS/Alune');
  await fs.writeFile(c, '#include <stdio.h>\n#include <unistd.h>\nint main(int argc,char **argv){if(argc>1){while(1)pause();}FILE *f=fopen(' + JSON.stringify(marker) + ',"w");if(!f)return 1;fprintf(f,"{\\"version\\":\\"0.10.0\\",\\"pid\\":%d}",getpid());fclose(f);return 0;}');
  await exec('/usr/bin/clang', [c, '-o', binary]);
  const before = { plist: hash(await fs.readFile(path.join(target, 'Contents/Info.plist'))), binary: hash(await fs.readFile(binary)) };
  const settings = path.join(root, 'profile/retained-settings.json');
  await fs.writeFile(settings, JSON.stringify({ fixture: true, theme: 'dark', repositoryTabs: ['retained'] }));
  const settingsHash = hash(await fs.readFile(settings));
  const launcher = path.join(root, 'reject-new-then-open-old.sh');
  await fs.writeFile(launcher, '#!/bin/sh\nversion=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$2/Contents/Info.plist") || exit 1\nprintf "%s\\n" "$version" >> attempted-versions\n[ "$version" = "0.10.0" ] || exit 1\nexec /usr/bin/open -n "$2"\n', { mode: 0o700 });
  parent = spawn(binary, ['--wait'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { parent.once('spawn', resolve); parent.once('error', reject); });
  const installer = createMacInstaller({ appBundle: target, cacheDir, arch: process.arch, parentPid: parent.pid, launcher });
  prepared = await installer.prepare(dmg, '0.11.0');
  assert.equal(hash(await fs.readFile(binary)), before.binary, 'staging must retain the running original');
  const stagedAsarSha256 = hash(await fs.readFile(path.join(prepared.stageDir, 'Alune.app/Contents/Resources/app.asar')));
  helper = await installer.install(prepared); const helperDone = exited(helper);
  await prepared.dispose(); // Handoff must preserve stage until the parent exits.
  assert.equal(hash(await fs.readFile(binary)), before.binary);
  await stop(parent);
  assert.equal(await helperDone, 1, 'the deliberate launch refusal must report failure');
  const deadline = Date.now() + 15000;
  while (true) {
    try { if (JSON.parse(await fs.readFile(marker, 'utf8')).version === '0.10.0') break; } catch {}
    assert(Date.now() < deadline, 'restored original did not actually start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(hash(await fs.readFile(binary)), before.binary);
  assert.equal(hash(await fs.readFile(path.join(target, 'Contents/Info.plist'))), before.plist);
  assert.equal(hash(await fs.readFile(settings)), settingsHash);
  assert.equal(await fs.readFile(path.join(cacheDir, 'attempted-versions'), 'utf8'), '0.11.0\n0.10.0\n');
  statusMessage = await takeInstallError(cacheDir); assert.match(statusMessage, /新版本未能启动，已恢复原版本/);
  assert.equal(await takeInstallError(cacheDir), null);
  assert.deepEqual(await fs.readdir(path.dirname(target)), ['Alune.app']);
  await fs.copyFile(path.join(cacheDir, 'attempted-versions'), path.join(out, 'attempted-versions.txt'));
  await fs.copyFile(marker, path.join(out, 'restored-startup.json'));
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ result: 'passed', inputHashes, stagedAsarSha256, original: before, statusMessage,
    actualReleasedPayload: '0.11.0', deliberateFirstLaunchRefusal: true, restoredBinaryByteIdentical: true, retainedSettingsUnchanged: true, restoredOriginalActuallyStartedViaOpen: true,
    limitations: 'Original is a native fixture, not an installed old Alune application. New release launch deliberately refused before execution; this does not certify successful updated-Alune startup, native-update or normal installed-upgrade-rollback gates.' }, null, 2));
  passed = true; console.log('Released DMG launch refusal restored and actually relaunched the native original');
} catch (error) { failure = { name: error.name, message: error.message }; throw error; }
finally {
  await stop(parent); await stop(helper); await prepared?.dispose();
  await fs.rm(root, { recursive: true, force: true });
  await fs.writeFile(path.join(out, 'execution.json'), JSON.stringify({ passed, failure, scratchRemoved: true }, null, 2));
}
