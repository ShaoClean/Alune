const { EventEmitter } = require('node:events');
const semver = require('semver');

function stableVersion(value) {
  if (typeof value !== 'string') return null;
  const version = semver.valid(value);
  return version && semver.prerelease(version) === null ? version : null;
}

function errorMessage(error) {
  if (error?.code === 'ENOSPC') return '磁盘空间不足，请释放空间后重试。';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return '没有写入更新文件的权限，请检查目录权限后重试。';
  return String(error?.message || error || '更新失败，请重试。').slice(0, 1500);
}

class UpdateService extends EventEmitter {
  constructor({ version, platform, supported = true, adapter, closeBackend, cleanupTimeout = 5000 }) {
    super();
    this.adapter = adapter;
    this.closeBackend = closeBackend;
    this.cleanupTimeout = cleanupTimeout;
    this.active = null;
    this.downloaded = null;
    this.state = {
      revision: 0, status: 'idle', currentVersion: version, platform,
      installMode: platform === 'darwin' ? 'manual' : 'restart', supported,
      latestVersion: null, releaseNotes: '', progress: null, error: null, background: false,
    };
  }

  getState() { return structuredClone(this.state); }

  setState(patch) {
    Object.assign(this.state, patch, { revision: this.state.revision + 1 });
    this.emit('state', this.getState());
  }

  run(action, work) {
    if (this.active) return this.active.promise;
    const task = { controller: new AbortController(), action };
    this.active = task;
    task.promise = Promise.resolve().then(() => work(task.controller.signal)).catch((error) => {
      if (task.controller.signal.aborted) {
        this.setState({ status: this.state.latestVersion ? 'available' : 'idle', progress: null, error: null });
      } else {
        this.setState({ status: 'error', error: { action, message: errorMessage(error) }, progress: null });
      }
    }).finally(() => { if (this.active === task) this.active = null; }).then(() => this.getState());
    return task.promise;
  }

  check({ background = false } = {}) {
    if (this.active) {
      if (!background) this.setState({ background: false });
      return this.active.promise;
    }
    if (this.downloaded || this.state.status === 'installing') return Promise.resolve(this.getState());
    this.setState({ status: 'checking', background, error: null, latestVersion: null, releaseNotes: '', progress: null });
    return this.run('check', async (signal) => {
      if (!this.state.supported) throw new Error('当前运行方式不支持更新，请使用已安装的正式桌面应用（Linux 使用 AppImage）。');
      const info = await this.adapter.check(signal);
      const version = stableVersion(info?.version);
      if (!version || !semver.gt(version, this.state.currentVersion)) {
        this.setState({ status: 'not-available' });
        return;
      }
      this.setState({ status: 'available', latestVersion: version, releaseNotes: String(info.releaseNotes || '').slice(0, 100000) });
    });
  }

  download() {
    if (this.active) return this.active.promise;
    if (!this.state.latestVersion || this.downloaded) return Promise.resolve(this.getState());
    this.setState({ status: 'downloading', background: false, error: null, progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    return this.run('download', async (signal) => {
      const file = await this.adapter.download(signal, (progress) => {
        if (!signal.aborted) this.setState({ progress });
      });
      signal.throwIfAborted();
      this.downloaded = file;
      this.setState({ status: 'downloaded', progress: null });
    });
  }

  cancel() {
    if (this.active?.action === 'download') this.active.controller.abort();
    return this.active?.promise || Promise.resolve(this.getState());
  }

  install() {
    if (this.active) return this.active.promise;
    if (!this.downloaded || this.state.installMode !== 'restart') return Promise.resolve(this.getState());
    this.setState({ status: 'installing', error: null });
    return this.run('install', async () => {
      let timeout;
      try {
        await Promise.race([
          Promise.resolve().then(() => this.closeBackend()),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('关闭本地服务超时，已中止安装。请重启应用后重试。')), this.cleanupTimeout);
          }),
        ]);
      } finally { clearTimeout(timeout); }
      await this.adapter.install();
    });
  }

  openFile(reveal = false) {
    if (this.active) return this.active.promise;
    if (!this.downloaded || this.state.installMode !== 'manual') return Promise.resolve(this.getState());
    return this.run('open', async () => {
      try { await this.adapter.openFile(this.downloaded, reveal); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        this.downloaded = null;
        this.setState({ status: 'error', error: { action: 'download', message: '已下载的安装包已被移动或删除，请重新下载。' } });
        return;
      }
      this.setState({ status: 'downloaded', error: null });
    });
  }
}

module.exports = { UpdateService, stableVersion, errorMessage };
