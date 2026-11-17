// Read the real production feed; download and stage into a private directory.
// Installation/relaunch are intentionally separate evidence requirements.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createMacUpdater } = require('../src/mac-updater.cjs');
const { createMacInstaller } = require('../src/mac-installer.cjs');
const [outArg] = process.argv.slice(2);
if (!outArg || process.argv.length !== 3) throw Error('Usage: critical-live-mac-update.mjs NEW_OUTPUT');
assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
const out = path.resolve(outArg); fs.mkdirSync(out, { mode: 0o700 });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-critical-live-update-'));
const target = path.join(scratch, 'Applications/Alune.app'), cacheDir = path.join(scratch, 'cache');
fs.mkdirSync(target, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requests = [], states = [];
const fetchImpl = async (url, options) => {
  const safeURL = new URL(url), queryRedacted = Boolean(safeURL.search);
  safeURL.search = ''; safeURL.hash = '';
  const record = { url: safeURL.href, queryRedacted, method: options.method, startedAt: new Date().toISOString() }; requests.push(record);
  try { const response = await fetch(url, options); record.status = response.status; return response; }
  catch (error) { record.error = error.message; throw error; }
};
let prepared, result = 'failed', failure, downloaded;
const inputs = Object.fromEntries(['mac-updater.cjs', 'mac-installer.cjs', 'update-service.cjs'].map(file => [file, hash(fs.readFileSync(new URL('../src/' + file, import.meta.url)))]));
const driverSha256 = hash(fs.readFileSync(new URL(import.meta.url)));
try {
  // A private prerelease input permits checking the immutable existing stable
  // release, without editing any project/package version or publishing a build.
  const adapter = createMacUpdater({ version: '0.11.0-rc.1', arch: process.arch, cacheDir, fetchImpl,
    installer: createMacInstaller({ appBundle: target, cacheDir, arch: process.arch }),
    app: { quit: () => assert.fail('this drill must not install') }, shell: {} });
  const signal = AbortSignal.timeout(300000);
  const candidate = await adapter.check(signal); assert(candidate, 'a newer stable release is required');
  states.push({ stage: 'production-feed', candidate });
  const file = await adapter.download(signal, progress => { if (progress.percent === 100) states.push({ stage: 'downloaded', ...progress }); });
  downloaded = { name: path.basename(file), bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) };
  prepared = await adapter.prepareInstall(file);
  const appAsar = path.join(prepared.stageDir, 'Alune.app/Contents/Resources/app.asar');
  states.push({ stage: 'native-mounted-and-staged', version: candidate.version, asarSha256: hash(fs.readFileSync(appAsar)) });
  result = 'passed';
  console.log('Production feed, real download, checksum and native staging passed');
} catch (error) {
  failure = { name: error.name, message: error.message, code: error.code };
  console.error(error.message); process.exitCode = 1;
} finally {
  await prepared?.dispose();
  fs.rmSync(scratch, { recursive: true, force: true });
  const sourceUnchanged = Object.entries(inputs).every(([file, expected]) => hash(fs.readFileSync(new URL('../src/' + file, import.meta.url))) === expected) && hash(fs.readFileSync(new URL(import.meta.url))) === driverSha256;
  if (!sourceUnchanged) { result = 'failed'; process.exitCode = 1; }
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ result, failure, inputs, driverSha256, sourceUnchanged, requests, states, downloaded,
    policy: 'mac-arm64-local-2026-11-08', syntheticCurrentVersion: '0.11.0-rc.1',
    limitations: 'No installed candidate was updated, no application replacement/relaunch, no native-update gate receipt. Production sources and versions unchanged. Hosted-only tools not invoked.', scratchRemoved: !fs.existsSync(scratch),
  }, null, 2));
}
