// Validate the four independent build artifacts before binding their hashes to
// a desktop candidate or adding the matching archives to a draft release.
import { createHash } from 'node:crypto';
import { readFileSync, copyFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const [action, input, dest] = process.argv.slice(2);
if (!['catalog', 'collect'].includes(action) || !input || !dest)
  throw Error('Usage: release-assets.mjs catalog|collect DOWNLOADED_ARTIFACTS DIRECTORY');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version;
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const digest = (data) => createHash('sha256').update(data).digest('hex');
const catalog = { schemaVersion: 1, version, sourceSha: sha, targets: {} };
const validated = [];
for (const target of ['linux-x64', 'win32-x64', 'darwin-arm64', 'darwin-x64']) {
  const dir = path.join(input, 'ssh-deploy-' + target);
  const pin = JSON.parse(readFileSync(path.join(dir, 'release.json'), 'utf8'));
  const file = path.join(dir, 'agent.tar.gz');
  if (
    pin.target !== target ||
    pin.version !== version ||
    pin.sourceSha !== sha ||
    pin.protocol?.major !== 1 ||
    !Number.isInteger(pin.protocol.minor) ||
    !/^[0-9a-f]{64}$/.test(pin.manifestSha256) ||
    digest(readFileSync(file)) !== pin.sha256
  )
    throw Error('Mismatched release artifact: ' + target);
  catalog.targets[target] = {
    sha256: pin.sha256,
    manifestSha256: pin.manifestSha256,
    protocol: pin.protocol,
  };
  validated.push({
    file,
    name: 'alune-agent-' + version + '-' + target + '.tar.gz',
    sha: pin.sha256,
  });
}
mkdirSync(dest, { recursive: true });
const catalogName = 'agent-catalog.json',
  catalogBytes = JSON.stringify(catalog, null, 2) + '\n';
writeFileSync(path.join(dest, catalogName), catalogBytes);
if (action === 'collect') {
  for (const a of validated) copyFileSync(a.file, path.join(dest, a.name));
  appendFileSync(
    path.join(dest, 'SHA256SUMS'),
    [
      ...validated.map((a) => a.sha + '  ' + a.name),
      digest(catalogBytes) + '  ' + catalogName,
    ].join('\n') + '\n',
  );
}
