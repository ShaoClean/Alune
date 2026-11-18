import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProtocolError, PROTOCOL_VERSION } from '@alune/protocol';
const targets = ['linux-x64', 'darwin-arm64', 'darwin-x64', 'win32-x64'];
const limit = 256 * 1024 * 1024;
const unavailable = (reason: string) => new ProtocolError('unavailable', reason);
async function download(url: string, send: typeof fetch, signal?: AbortSignal) {
  for (let n = 0; n < 5; n++) {
    const response = await send(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) break;
      const next = new URL(location, url);
      if (
        next.protocol !== 'https:' ||
        next.port ||
        next.username ||
        next.password ||
        ![
          'github.com',
          'release-assets.githubusercontent.com',
          'objects.githubusercontent.com',
        ].includes(next.hostname)
      )
        throw unavailable('Unexpected SSH release redirect');
      url = next.href;
      continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw unavailable('SSH release download failed: ' + response.status);
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw unavailable('SSH bundle exceeds size limit');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks, length);
  }
  throw unavailable('Invalid SSH release redirects');
}
export async function readBundle(
  directory: string,
  target: string,
  send?: typeof fetch,
  signal?: AbortSignal,
) {
  if (!targets.includes(target)) throw unavailable('Unsupported SSH target');
  const version: string = require('../../version.json').version;
  const catalogFile = process.env.ALUNE_AGENT_RELEASE_CATALOG,
    base = join(directory, 'ssh-bundles', target);
  const pin = catalogFile
    ? await (async () => {
        const catalog = JSON.parse(await readFile(catalogFile, 'utf8')),
          entry = catalog.targets?.[target];
        if (
          !entry ||
          catalog.schemaVersion !== 1 ||
          catalog.version !== version ||
          entry.protocol?.major !== PROTOCOL_VERSION.major ||
          entry.protocol.minor !== PROTOCOL_VERSION.minor
        )
          throw new ProtocolError(
            'incompatible-version',
            'Desktop release catalog does not match the Agent',
          );
        return { ...entry, target, version };
      })()
    : JSON.parse(
        await readFile(join(base, 'release.json'), 'utf8').catch(() => {
          throw unavailable('Provision the trusted SSH bundle for ' + target);
        }),
      );
  if (
    !/^[0-9a-f]{64}$/.test(pin.sha256) ||
    !/^[0-9a-f]{64}$/.test(pin.manifestSha256) ||
    pin.target !== target ||
    pin.version !== version
  )
    throw new ProtocolError(
      'incompatible-version',
      'SSH release is not approved for this Agent version',
    );
  return {
    sha256: String(pin.sha256),
    manifestSha256: String(pin.manifestSha256),
    version,
    // Invoked only by an explicitly authorized install/upgrade. A regular
    // reconnect verifies the archive on the target without a network download.
    async bytes() {
      let bytes: Buffer;
      const file = join(base, 'agent.tar.gz');
      try {
        if ((await stat(file)).size > limit) throw unavailable('SSH bundle exceeds size limit');
        bytes = await readFile(file);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
        if (catalogFile) {
          if (!send) throw unavailable('Release download transport unavailable');
          bytes = await download(
            'https://github.com/ShaoClean/Alune/releases/download/v' +
              version +
              '/alune-agent-' +
              version +
              '-' +
              target +
              '.tar.gz',
            send,
            signal,
          );
        } else {
          throw unavailable('Provision the trusted SSH bundle for ' + target);
        }
      }
      if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
        throw unavailable('Local SSH bundle checksum mismatch');
      return bytes;
    },
  };
}
