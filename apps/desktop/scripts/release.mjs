import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { validatePackageVersions, validateTag as validateReleaseTag } from '../../../scripts/release-version.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const root = fileURLToPath(new URL('../../..', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
export const targets = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'];

export function artifacts(target, releaseVersion = version) {
  // electron-builder expands the AppImage x64 architecture to x86_64.
  const artifactTarget = target === 'linux-x64' ? 'linux-x86_64' : target;
  const prefix = `RemoteGit-${releaseVersion}-${artifactTarget}`;
  if (target.startsWith('mac-')) return [`${prefix}.dmg`, `${prefix}.dmg.blockmap`, `${prefix}.zip`, `${prefix}.zip.blockmap`];
  if (target === 'win-x64') return [`${prefix}.exe`, `${prefix}.exe.blockmap`, 'latest.yml'];
  if (target === 'linux-x64') return [`${prefix}.AppImage`, 'latest-linux.yml'];
  throw new Error(`Unsupported release target: ${target}`);
}

export function validateTag(tag, releaseVersion = version) {
  validateReleaseTag(tag, releaseVersion);
}

export async function verifyRelease(directory, releaseVersion = version) {
  const expected = targets.flatMap((target) => artifacts(target, releaseVersion));
  const actual = await readdir(directory);
  for (const name of expected) {
    if (!actual.includes(name) || !(await stat(path.join(directory, name))).size) throw new Error(`Missing or empty release asset: ${name}`);
  }
  if (actual.some((name) => !expected.includes(name) && name !== 'SHA256SUMS')) throw new Error('Unexpected files in release assets');
  for (const [metadata, target] of [['latest.yml', 'win-x64'], ['latest-linux.yml', 'linux-x64']]) {
    const info = yaml.load(await readFile(path.join(directory, metadata), 'utf8'));
    if (info.version !== releaseVersion || !Array.isArray(info.files) || info.files.length !== 1) throw new Error(`Invalid update metadata: ${metadata}`);
    const file = info.files[0];
    if (file.url !== artifacts(target, releaseVersion)[0]) throw new Error(`Incorrect update artifact: ${metadata}`);
    const bytes = await readFile(path.join(directory, file.url));
    if (file.size !== bytes.length || file.sha512 !== createHash('sha512').update(bytes).digest('base64')) throw new Error(`Update checksum/size mismatch: ${metadata}`);
    if (info.path !== file.url || info.sha512 !== file.sha512) throw new Error(`Legacy update metadata mismatch: ${metadata}`);
  }
  const checksums = [];
  for (const name of expected.sort()) {
    const bytes = await readFile(path.join(directory, name));
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await writeFile(path.join(directory, 'SHA256SUMS'), checksums.join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  if (command === 'tag') {
    validateTag(argument);
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    validatePackageVersions({ version }, lock);
  } else if (command === 'collect') {
    if (!targets.includes(argument)) throw new Error('Unknown release target');
    const release = path.join(root, 'apps/desktop/release');
    const destination = path.join(release, 'upload');
    await mkdir(destination, { recursive: true });
    for (const name of artifacts(argument)) await cp(path.join(release, name), path.join(destination, name));
  } else if (command === 'verify') {
    if (!argument) throw new Error('Release asset directory is required');
    await verifyRelease(path.resolve(argument));
  } else throw new Error('Usage: release.mjs tag <vX.Y.Z> | collect <target> | verify <directory>');
}
