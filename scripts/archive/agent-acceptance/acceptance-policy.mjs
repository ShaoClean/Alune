import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const supportedTargets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

export function readPolicy(file) {
  if (!file) return { id: 'all-platforms', requiredTargets: supportedTargets, localProofs: false };
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    policy.schemaVersion !== 1 ||
    typeof policy.id !== 'string' ||
    !policy.id.trim() ||
    !Array.isArray(policy.requiredTargets) ||
    !policy.requiredTargets.length ||
    new Set(policy.requiredTargets).size !== policy.requiredTargets.length ||
    policy.requiredTargets.some((target) => !supportedTargets.includes(target)) ||
    typeof policy.localProofs !== 'boolean'
  )
    throw Error('Invalid acceptance policy');
  return policy;
}

export function validProof(proof, evidenceFile, policy) {
  if (typeof proof === 'string')
    return /^https:\/\/(?:github\.com|raw\.githubusercontent\.com)\//.test(proof);
  if (
    !policy.localProofs ||
    !proof ||
    typeof proof.path !== 'string' ||
    !/^[0-9a-f]{64}$/.test(proof.sha256) ||
    path.isAbsolute(proof.path)
  )
    return false;
  try {
    const root = fs.realpathSync(path.dirname(path.resolve(evidenceFile)));
    const file = fs.realpathSync(path.resolve(root, proof.path));
    const relative = path.relative(root, file);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    )
      return false;
    if (!fs.statSync(file).isFile()) return false;
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex') === proof.sha256;
  } catch {
    return false;
  }
}
