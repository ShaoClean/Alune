export const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateTag(tag, version) {
  if (!stableTagPattern.test(tag) || tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must equal package.json version v${version} and be stable SemVer`);
  }
}

export function validatePackageVersions(manifest, lock) {
  const version = manifest?.version;
  if (typeof version !== 'string' || !version) throw new Error('Root package.json must contain a version');
  if (lock?.version !== version || lock?.packages?.['']?.version !== version) {
    throw new Error(`Root package-lock.json version is out of sync with package.json (${version})`);
  }
}
