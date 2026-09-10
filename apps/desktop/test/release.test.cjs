const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
// electron-builder uses the AppImage architecture name in the output filename.
const linuxArtifact = 'RemoteGit-1.2.3-linux-x86_64.AppImage';

async function fixture(t) {
  const release = await import('../scripts/release.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'remote-git-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const target of release.targets) {
    const files = target === 'linux-x64' ? [linuxArtifact, 'latest-linux.yml'] : release.artifacts(target, '1.2.3');
    for (const file of files) await writeFile(path.join(directory, file), 'installer test fixture');
  }
  for (const [name, target] of [['latest.yml', 'win-x64'], ['latest-linux.yml', 'linux-x64']]) {
    const url = target === 'linux-x64' ? linuxArtifact : release.artifacts(target, '1.2.3')[0];
    const bytes = await readFile(path.join(directory, url));
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    await writeFile(path.join(directory, name), yaml.dump({ version: '1.2.3', files: [{ url, size: bytes.length, sha512 }], path: url, sha512 }));
  }
  return { ...release, directory };
}

test('release tags must match the root stable version', async () => {
  const { validateTag } = await import('../scripts/release.mjs');
  validateTag('v1.2.3', '1.2.3');
  for (const tag of ['v1.2.2', 'v1.2.3-beta.1', '1.2.3', 'v1.2', 'v1.02.3']) assert.throws(() => validateTag(tag, '1.2.3'));
});

test('complete releases accept electron-builder AppImage names and both macOS architectures', async (t) => {
  const { directory, verifyRelease } = await fixture(t);
  await verifyRelease(directory, '1.2.3');
  const sums = await readFile(path.join(directory, 'SHA256SUMS'), 'utf8');
  assert.match(sums, /^[a-f0-9]{64}  RemoteGit-1\.2\.3-mac-arm64\.dmg$/m);
  assert.match(sums, /^[a-f0-9]{64}  RemoteGit-1\.2\.3-mac-x64\.dmg$/m);
  assert.match(sums, /^[a-f0-9]{64}  RemoteGit-1\.2\.3-linux-x86_64\.AppImage$/m);
});

test('release publication rejects missing platform artifacts and corrupt metadata', async (t) => {
  for (const failure of ['missing', 'checksum', 'version', 'unexpected']) {
    const { directory, verifyRelease } = await fixture(t);
    if (failure === 'missing') await rm(path.join(directory, 'RemoteGit-1.2.3-mac-x64.dmg'));
    if (failure === 'checksum') await writeFile(path.join(directory, 'RemoteGit-1.2.3-win-x64.exe'), 'corrupted bytes');
    if (failure === 'version') {
      const file = path.join(directory, 'latest-linux.yml');
      await writeFile(file, (await readFile(file, 'utf8')).replace('1.2.3', '1.2.2'));
    }
    if (failure === 'unexpected') await writeFile(path.join(directory, 'unexpected-installer.exe'), 'bad');
    await assert.rejects(verifyRelease(directory, '1.2.3'));
    await assert.rejects(readFile(path.join(directory, 'SHA256SUMS')), { code: 'ENOENT' });
  }
});
