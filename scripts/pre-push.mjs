import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validatePackageVersions, validateTag } from './release-version.mjs';

function readCommittedJson(object, file) {
  try {
    // Peel annotated tags and inspect the pushed commit, never the working tree.
    const contents = execFileSync('git', ['show', `${object}^{commit}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(contents);
  } catch {
    throw new Error(`Cannot read valid ${file} from pushed commit ${object.slice(0, 12)}`);
  }
}

let failed = false;
for (const line of readFileSync(0, 'utf8').split(/\r?\n/).filter((line) => line.trim())) {
  const [, localObject, remoteRef] = line.trim().split(/\s+/);
  if (/^0+$/.test(localObject)) continue; // Deleting a ref does not publish a release.
  const releaseTag = remoteRef?.startsWith('refs/tags/v') ? remoteRef.slice('refs/tags/'.length) : undefined;
  if (!releaseTag && !remoteRef?.startsWith('refs/heads/')) continue;

  try {
    const manifest = readCommittedJson(localObject, 'package.json');
    const lock = readCommittedJson(localObject, 'package-lock.json');
    if (releaseTag) validateTag(releaseTag, manifest?.version);
    validatePackageVersions(manifest, lock);
  } catch (error) {
    console.error(`[pre-push] Blocked ${remoteRef}: ${error.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('[pre-push] Update and commit the root package.json and package-lock.json together.');
  console.error('[pre-push] Release tags must point to that commit and match its version (vX.Y.Z).');
  process.exitCode = 1;
}
