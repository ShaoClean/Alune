// Provision only trusted build output. RPC clients cannot choose a local file or URL.
import {
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  lstatSync,
  renameSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [source, data] = process.argv.slice(2);
if (!source || !data) throw new Error('Usage: ssh-bundle.mjs PACKAGED_AGENT LOCAL_AGENT_DATA_DIR');
const bytes = readFileSync(join(source, 'manifest.json'));
const manifest = JSON.parse(bytes);
const digest = (b) => createHash('sha256').update(b).digest('hex');
if (!['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'].includes(manifest.target))
  throw Error('Unsupported target');
const root = realpathSync(source),
  names = Object.keys(manifest.files);
for (const name of names) {
  if (
    !name ||
    name.startsWith('-') ||
    /[\r\n\\:]/.test(name) ||
    name.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    throw Error('Unsafe package member');
  const file = join(root, name);
  if (
    !lstatSync(file).isFile() ||
    relative(root, realpathSync(file)).split('\\').join('/') !== name
  )
    throw Error('Package member must be an ordinary file inside the bundle: ' + name);
  if (digest(readFileSync(file)) !== manifest.files[name])
    throw Error('Invalid package file: ' + name);
}
const dest = join(resolve(data), 'ssh-bundles', manifest.target);
mkdirSync(dest, { recursive: true, mode: 0o700 });
const staging = mkdtempSync(join(dest, '.build-'));
try {
  const file = join(staging, 'agent.tar.gz');
  // Only manifest-listed files enter the archive; archive paths have no build-directory prefix.
  // GNU tar treats C: as a remote host. Let Node own the output path;
  // piping tar's binary stdout into an fd also avoids buffering the archive.
  const output = openSync(file, 'wx', 0o600);
  try {
    execFileSync('tar', ['-czf', '-', '-T', '-'], {
      cwd: source,
      stdio: ['pipe', output, 'pipe'],
      input: ['manifest.json', ...names].join('\n') + '\n',
    });
  } finally {
    closeSync(output);
  }
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
