const { CancellationToken } = require('builder-util-runtime');

function releaseNotes(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => `${entry.version || ''}\n${entry.note || ''}`).join('\n\n');
  return '';
}

function createElectronUpdater({ updater, nativeUpdater, logger = console, checkTimeout = 60000, idleTimeout = 60000 }) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.autoRunAppAfterInstall = true;
  updater.logger = logger;
  updater.setFeedURL({ provider: 'github', owner: 'ShaoClean', repo: 'remote-git', private: false, releaseType: 'release' });
  // The library also emits errors for rejected operations. Always handle that event.
  updater.on('error', (error) => logger.error('[updater]', error.message));

  return {
    async check() {
      let timeout;
      try {
        const result = await Promise.race([
          updater.checkForUpdates(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('检查更新超时，请检查网络后重试。')), checkTimeout);
          }),
        ]);
        if (!result?.isUpdateAvailable) return null;
        return { version: result.updateInfo.version, releaseNotes: releaseNotes(result.updateInfo.releaseNotes) };
      } finally { clearTimeout(timeout); }
    },

    async download(signal, onProgress) {
      const token = new CancellationToken();
      let timeout;
      let timedOut = false;
      const resetTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { timedOut = true; token.cancel(); }, idleTimeout);
      };
      const progress = (value) => { resetTimeout(); onProgress(value); };
      const cancel = () => token.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      updater.on('download-progress', progress);
      try {
        signal.throwIfAborted();
        resetTimeout();
        const files = await updater.downloadUpdate(token);
        signal.throwIfAborted();
        if (!files?.[0]) throw new Error('未找到下载完成的安装包。');
        return files[0];
      } catch (error) {
        if (timedOut && !signal.aborted) throw new Error('下载长时间无响应，请检查网络后重试。');
        throw error;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        updater.off('download-progress', progress);
      }
    },

    install() {
      return new Promise((resolve, reject) => {
        const done = (error) => {
          clearTimeout(timeout);
          updater.off('error', failed);
          nativeUpdater.off('before-quit-for-update', succeeded);
          if (error) reject(error); else resolve();
        };
        const failed = (error) => done(error);
        const succeeded = () => done();
        const timeout = setTimeout(() => done(new Error('安装程序未能启动，请重启应用后重试。')), 30000);
        updater.once('error', failed);
        nativeUpdater.once('before-quit-for-update', succeeded);
        try { updater.quitAndInstall(false, true); } catch (error) { done(error); }
      });
    },
  };
}

module.exports = { createElectronUpdater };
