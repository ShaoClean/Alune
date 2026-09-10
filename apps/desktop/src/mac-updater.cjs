const { createHash } = require('node:crypto');
const { mkdir, open, rename, rm, access } = require('node:fs/promises');
const path = require('node:path');
const semver = require('semver');
const { stableVersion } = require('./update-service.cjs');

const repository = 'ShaoClean/remote-git';
const downloadPrefix = `https://github.com/${repository}/releases/download/`;
const redirectHosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function assetURL(asset) {
  const value = asset?.browser_download_url;
  if (typeof value !== 'string' || !value.startsWith(downloadPrefix)) throw new Error('更新附件地址无效。');
  const url = new URL(value);
  if (url.username || url.password || url.port) throw new Error('更新附件地址无效。');
  return value;
}

async function githubFetch(fetchImpl, url, signal) {
  for (let count = 0; count < 6; count++) {
    const response = await fetchImpl(url, {
      signal, redirect: 'manual', headers: {
        'User-Agent': 'RemoteGit-Updater',
        Accept: new URL(url).hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('更新下载重定向缺少地址。');
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || !redirectHosts.has(next.hostname) || next.username || next.password || next.port) {
        throw new Error('更新下载重定向到了不受信任的地址。');
      }
      url = next.href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) throw new Error('尚无可访问的正式 Release 或更新附件。请确认 GitHub 仓库已公开且发布完整。');
      if ([403, 429].includes(response.status)) throw new Error('GitHub 请求被限制，请稍后重试或检查网络访问权限。');
      throw new Error(`GitHub 请求失败（HTTP ${response.status}），请稍后重试。`);
    }
    return response;
  }
  throw new Error('更新下载重定向次数过多。');
}

async function smallText(response, limit = 2 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('更新元数据过大。');
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts).toString('utf8');
}

function checksumFor(text, name) {
  const matches = text.split(/\r?\n/).map((line) => /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line))
    .filter((match) => match && match[2] === name);
  if (matches.length !== 1) throw new Error('更新包缺少唯一的 SHA-256 校验记录。');
  return matches[0][1].toLowerCase();
}

function createMacUpdater({ version, arch, cacheDir, shell, fetchImpl = fetch, metadataTimeout = 30000, idleTimeout = 60000 }) {
  let candidate;
  return {
    async check(signal) {
      candidate = null;
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(metadataTimeout)]);
      const response = await githubFetch(fetchImpl, `https://api.github.com/repos/${repository}/releases/latest`, requestSignal);
      const release = JSON.parse(await smallText(response));
      const nextVersion = stableVersion(release.tag_name);
      if (release.draft || release.prerelease || !nextVersion || !semver.gt(nextVersion, version)) return null;
      if (!['arm64', 'x64'].includes(arch)) throw new Error(`暂不支持此 macOS 架构：${arch}`);
      const name = `RemoteGit-${nextVersion}-mac-${arch}.dmg`;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const dmg = assets.find((asset) => asset.name === name);
      const checksums = assets.find((asset) => asset.name === 'SHA256SUMS');
      if (!dmg || !checksums) throw new Error(`此版本缺少 ${arch} 安装包或 SHA256SUMS，请等待发布完成后重试。`);
      if (!Number.isSafeInteger(dmg.size) || dmg.size <= 0) throw new Error('更新包大小无效。');
      const url = assetURL(dmg);
      const checksumResponse = await githubFetch(fetchImpl, assetURL(checksums), requestSignal);
      const sha256 = checksumFor(await smallText(checksumResponse, 128 * 1024), name);
      candidate = { name, url, size: dmg.size, sha256 };
      return { version: nextVersion, releaseNotes: release.body || '' };
    },

    async download(signal, onProgress) {
      if (!candidate) throw new Error('请先检查新版本。');
      const { name, url, size, sha256 } = candidate;
      const file = path.join(cacheDir, name);
      const partial = `${file}.part`;
      const timeoutController = new AbortController();
      const downloadSignal = AbortSignal.any([signal, timeoutController.signal]);
      let idleTimer;
      const resetTimeout = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => timeoutController.abort(new Error('下载长时间无响应，请检查网络后重试。')), idleTimeout);
      };
      let handle;
      try {
        await mkdir(cacheDir, { recursive: true, mode: 0o700 });
        // Only partial downloads are replaced. A verified file is never exposed before rename.
        await rm(partial, { force: true });
        handle = await open(partial, 'wx', 0o600);
        resetTimeout();
        const response = await githubFetch(fetchImpl, url, downloadSignal);
        const hash = createHash('sha256');
        let transferred = 0;
        let lastProgress = 0;
        const started = Date.now();
        for await (const chunk of response.body) {
          downloadSignal.throwIfAborted();
          resetTimeout();
          transferred += chunk.length;
          if (transferred > size) throw new Error('下载内容超过声明大小，已中止。');
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
            if (!bytesWritten) throw new Error('无法写入更新文件。');
            offset += bytesWritten;
          }
          const now = Date.now();
          if (now - lastProgress >= 200 || transferred === size) {
            onProgress({ percent: Math.min(100, transferred / size * 100), transferred, total: size, bytesPerSecond: transferred / Math.max(1, (now - started) / 1000) });
            lastProgress = now;
          }
        }
        downloadSignal.throwIfAborted();
        if (transferred !== size || hash.digest('hex') !== sha256) throw new Error('更新包完整性校验失败，请重新下载。');
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(partial, file);
        return file;
      } catch (error) {
        if (timeoutController.signal.aborted && !signal.aborted) throw timeoutController.signal.reason;
        throw error;
      } finally {
        clearTimeout(idleTimer);
        await handle?.close();
        await rm(partial, { force: true });
      }
    },

    async openFile(file, reveal) {
      await access(file);
      if (reveal) shell.showItemInFolder(file);
      else {
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      }
    },
  };
}

module.exports = { createMacUpdater, checksumFor, githubFetch, assetURL };
