// Provision only trusted build output. RPC clients cannot choose a local file or URL.
import { readFileSync, writeFileSync, mkdirSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [source, data] = process.argv.slice(2);
if (!source || !data) throw new Error('Usage: ssh-bundle.mjs PACKAGED_AGENT LOCAL_AGENT_DATA_DIR');
const bytes = readFileSync(join(source, 'manifest.json'));
const manifest = JSON.parse(bytes);
const digest = (b) => createHash('sha256').update(b).digest('hex');
if (!['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'].includes(manifest.target))
  throw Error('Unsupported target');
for (const [name, hash] of Object.entries(manifest.files))
  if (digest(readFileSync(join(source, name))) !== hash)
    throw Error('Invalid package file: ' + name);
const dest = join(resolve(data), 'ssh-bundles', manifest.target);
mkdirSync(dest, { recursive: true, mode: 0o700 });
const staging = mkdtempSync(join(dest, '.build-'));
try {
  const file = join(staging, 'agent.tar.gz');
  // Only manifest-listed files enter the archive; archive paths have no build-directory prefix.
  const names = Object.keys(manifest.files);
  if (
    names.some(
      (n) =>
        !n ||
        n.startsWith('-') ||
        n.includes('..' + '/') ||
        n.startsWith('/') ||
        /[\r\n\\]/.test(n),
    )
  )
    throw Error('Unsafe package member');
  execFileSync('tar', ['-czf', file, '-T', '-'], {
    cwd: source,
    input: ['manifest.json', ...names].join('\n') + '\n',
  });
  const pin = {
    target: manifest.target,
    version: manifest.version,
    sha256: digest(readFileSync(file)),
    manifestSha256: digest(bytes),
  };
  writeFileSync(join(staging, 'release.json'), JSON.stringify(pin) + '\n');
  renameSync(file, join(dest, 'agent.tar.gz'));
  renameSync(join(staging, 'release.json'), join(dest, 'release.json'));
  console.log(JSON.stringify(pin));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
