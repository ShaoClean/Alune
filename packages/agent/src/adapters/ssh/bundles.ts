import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProtocolError, PROTOCOL_VERSION } from '@alune/protocol';
const targets = ['linux-x64', 'darwin-arm64', 'darwin-x64', 'win32-x64'];
const unavailable = (reason: string) => new ProtocolError('unavailable', reason);

export async function readBundle(directory: string, target: string) {
  if (!targets.includes(target)) throw unavailable('Unsupported SSH target');
  const version: string = require('../../version.json').version;
  const catalogFile = process.env.ALUNE_AGENT_RELEASE_CATALOG,
    base = join(directory, 'ssh-bundles', target),
    localPin = await readFile(join(base, 'release.json'), 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => undefined);
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
    : localPin;
  if (!pin) throw unavailable('Provision the trusted SSH bundle for ' + target);
  if (
    !/^[0-9a-f]{64}$/.test(pin.sha256) ||
    !/^[0-9a-f]{64}$/.test(pin.manifestSha256) ||
    pin.protocol?.major !== PROTOCOL_VERSION.major ||
    pin.protocol?.minor !== PROTOCOL_VERSION.minor ||
    pin.target !== target ||
    pin.version !== version
  )
    throw new ProtocolError(
      'incompatible-version',
      'SSH release is not approved for this Agent version',
    );
  const mirror = process.env.ALUNE_AGENT_RELEASE_MIRROR;
  const baseUrl = new URL(
    mirror || `https://github.com/ShaoClean/Alune/releases/download/v${version}/`,
  );
  if (
    !['https:', 'http:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw unavailable('Invalid SSH release mirror URL');
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  const url = new URL(`alune-agent-${version}-${target}.tar.gz`, baseUrl).href;
  return { version, target, sha256: String(pin.sha256), url };
}
