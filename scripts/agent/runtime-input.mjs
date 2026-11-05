// Reuse an installed distribution only when both files that will ship match
// the bytes independently pinned from the official platform archive.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function readPinnedRuntime(executable, licensePath, pin) {
  // Normally a developer's Node differs; avoid loading a large executable
  // when its size or the accompanying license is already wrong.
  try {
    if (
      fs.statSync(executable).size !== pin.executableBytes ||
      fs.statSync(licensePath).size !== pin.licenseBytes
    )
      return null;
    const license = fs.readFileSync(licensePath);
    if (digest(license) !== pin.licenseSha256) return null;
    const binary = fs.readFileSync(executable);
    if (digest(binary) !== pin.executableSha256) return null;
    return { binary, license };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}
export function distributionLicense(executable, platform) {
  return path.resolve(path.dirname(executable), ...(platform === 'win32' ? [] : ['..']), 'LICENSE');
}
