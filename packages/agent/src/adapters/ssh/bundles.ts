import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProtocolError, PROTOCOL_VERSION } from '@alune/protocol';
const targets = ['linux-x64', 'darwin-arm64', 'darwin-x64', 'win32-x64'];
const limit = 256 * 1024 * 1024;
const unavailable = (reason: string) => new ProtocolError('unavailable', reason);

export interface BundleDownloadProgress {
  transferred: number;
  total: number | null;
  percent: number | null;
  bytesPerSecond: number;
}

async function download(
  url: string,
  send: typeof fetch,
  signal?: AbortSignal,
  onProgress?: (progress: BundleDownloadProgress) => void,
) {
  for (let n = 0; n < 5; n++) {
    let response: Response;
    try {
      response = await send(url, { redirect: 'manual', signal });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProtocolError) throw error;
      throw unavailable(
        'SSH release download failed: ' + (error instanceof Error ? error.message : String(error)),
      );
    }
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
    const rawLength = Number(response.headers.get('content-length'));
    const total = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : null;
    if (!response.ok || !response.body || (total !== null && total > limit)) {
      await response.body?.cancel();
      throw unavailable('SSH release download failed: ' + response.status);
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    const startedAt = Date.now();
    let lastReport = startedAt;
    onProgress?.({
      transferred: 0,
      total,
      percent: total ? 0 : null,
      bytesPerSecond: 0,
    });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw unavailable('SSH bundle exceeds size limit');
        chunks.push(value);
        const now = Date.now();
        if (onProgress && now - lastReport >= 150) {
          lastReport = now;
          const elapsed = Math.max(0.001, (now - startedAt) / 1000);
          onProgress({
            transferred: length,
            total,
            percent: total ? Math.min(100, Number(((length / total) * 100).toFixed(1))) : null,
            bytesPerSecond: Math.round(length / elapsed),
          });
        }
      }
      if (onProgress) {
        const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
        onProgress({
          transferred: length,
          total: total ?? length,
          percent: 100,
          bytesPerSecond: Math.round(length / elapsed),
        });
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProtocolError) throw error;
      throw unavailable(
        'SSH release download failed: ' + (error instanceof Error ? error.message : String(error)),
      );
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
    base = join(directory, 'ssh-bundles', target),
    localPin = await readFile(join(base, 'release.json'), 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => undefined);
  const pin = localPin ??
    (catalogFile
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
      : undefined);
  if (!pin)
    throw unavailable('Provision the trusted SSH bundle for ' + target);
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
    async bytes(onProgress?: (progress: BundleDownloadProgress) => void) {
      let bytes: Buffer | undefined;
      let downloaded = false;
      const file = join(base, 'agent.tar.gz');
      try {
        if ((await stat(file)).size > limit) throw unavailable('SSH bundle exceeds size limit');
        const cached = await readFile(file);
        if (createHash('sha256').update(cached).digest('hex') === pin.sha256) {
          bytes = cached;
        } else if (!catalogFile || localPin) {
          throw unavailable('Local SSH bundle checksum mismatch');
        }
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (!bytes) {
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
            onProgress,
          );
          downloaded = true;
        } else {
          throw unavailable('Provision the trusted SSH bundle for ' + target);
        }
      }
      if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
        throw unavailable('Local SSH bundle checksum mismatch');
      if (downloaded) {
        const temp = join(base, `agent.tar.gz.${randomUUID()}.tmp`);
        try {
          await mkdir(base, { recursive: true });
          await writeFile(temp, bytes);
          await rename(temp, file);
        } catch {
          await rm(temp, { force: true }).catch(() => {});
        }
      }
      return bytes;
    },
  };
}
