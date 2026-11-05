import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProtocolError } from '@alune/protocol';

const targets = ['linux-x64', 'darwin-arm64', 'darwin-x64', 'win32-x64'];
export async function readBundle(directory: string, target: string) {
  if (!targets.includes(target)) throw new ProtocolError('unavailable', 'Unsupported SSH target');
  const base = join(directory, 'ssh-bundles', target);
  const pin = JSON.parse(
    await readFile(join(base, 'release.json'), 'utf8').catch(() => {
      throw new ProtocolError('unavailable', 'Provision the trusted SSH bundle for ' + target);
    }),
  );
  if (
    !/^[0-9a-f]{64}$/.test(pin.sha256) ||
    !/^[0-9a-f]{64}$/.test(pin.manifestSha256) ||
    pin.target !== target ||
    pin.version !== require('../../version.json').version
  )
    throw new ProtocolError(
      'incompatible-version',
      'SSH release is not approved for this Agent version',
    );
  const file = join(base, 'agent.tar.gz');
  if ((await stat(file)).size > 256 * 1024 * 1024)
    throw new ProtocolError('unavailable', 'SSH bundle exceeds size limit');
  return {
    sha256: String(pin.sha256),
    manifestSha256: String(pin.manifestSha256),
    version: String(pin.version),
    async bytes() {
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
        throw new ProtocolError('unavailable', 'Local SSH bundle checksum mismatch');
      return bytes;
    },
  };
}
