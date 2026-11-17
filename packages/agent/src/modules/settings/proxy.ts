import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { NetworkProxyConfig, SaveNetworkProxy } from '@alune/protocol';
import type { ProxySnapshot } from '../../adapters/network/proxy-transport';
import type { JsonDocument, SecretCipher } from '../../ports/state';
import { StateFault } from '../../ports/state';
import { settingsErrors, type SettingsErrors } from '../../ports/settings-errors';

type StoredProxy = Omit<NetworkProxyConfig, 'hasCredentials' | 'secretStorageAvailable'> & {
  encryptedCredentials?: string;
};
const defaults = (): StoredProxy => ({
  revision: randomUUID(),
  enabled: false,
  protocol: 'http',
  host: '',
  port: 8080,
  authEnabled: false,
});

function validate(value: StoredProxy, errors: SettingsErrors = settingsErrors) {
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    typeof value.authEnabled !== 'boolean' ||
    !['http', 'https', 'socks5'].includes(value.protocol) ||
    typeof value.host !== 'string' ||
    value.host.length > 253 ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  )
    throw errors.badRequest('代理类型或端口无效，端口应为 1–65535 的整数。');
  if (
    (!value.host && value.enabled) ||
    (value.host &&
      !isIP(value.host) &&
      !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value.host))
  )
    throw errors.badRequest('服务器地址应为 IP 或主机名，不包含协议、端口或路径。');
  if (
    typeof value.revision !== 'string' ||
    !value.revision ||
    (value.encryptedCredentials !== undefined && typeof value.encryptedCredentials !== 'string')
  )
    throw errors.badRequest('代理配置格式无效。');
}

export class ProxySettingsStore {
  private data = defaults();
  private loadError = false;
  constructor(
    private document: JsonDocument,
    readonly secrets: SecretCipher,
    private errors: SettingsErrors = settingsErrors,
  ) {
    try {
      const saved = document.read();
      if (saved === undefined) return;
      validate(saved as StoredProxy, this.errors);
      this.data = saved as StoredProxy;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = true;
    }
  }

  read(): NetworkProxyConfig {
    if (this.loadError)
      throw this.errors.unavailable('代理配置无法读取，请恢复配置文件后重启；不会回退直连。');
    const { revision, enabled, protocol, host, port, authEnabled, encryptedCredentials } =
      this.data;
    return {
      revision,
      enabled,
      protocol,
      host,
      port,
      authEnabled,
      hasCredentials: Boolean(encryptedCredentials),
      secretStorageAvailable: this.secrets.available,
    };
  }

  assertRevision(revision: unknown) {
    if (revision !== this.read().revision)
      throw this.errors.conflict('代理配置已变化，请重新加载后重试。');
  }

  snapshot(): ProxySnapshot {
    const config = this.read();
    let credentials: ProxySnapshot['credentials'];
    if (config.enabled && config.authEnabled) {
      try {
        const stored = JSON.parse(this.secrets.decrypt(this.data.encryptedCredentials!));
        if (
          !stored.username ||
          !stored.password ||
          stored.host !== config.host ||
          stored.port !== config.port ||
          stored.protocol !== config.protocol
        )
          throw new Error();
        credentials = { username: stored.username, password: stored.password };
      } catch {
        throw this.errors.unavailable('代理认证信息不可用，请重新保存认证信息；不会回退直连。');
      }
    }
    return {
      revision: config.revision,
      enabled: config.enabled,
      protocol: config.protocol,
      host: config.host,
      port: config.port,
      credentials,
    };
  }

  save(input: SaveNetworkProxy): NetworkProxyConfig {
    this.assertRevision(input?.revision);
    const next: StoredProxy = {
      revision: randomUUID(),
      enabled: input.enabled,
      protocol: input.protocol,
      host: typeof input.host === 'string' ? input.host.trim() : input.host,
      port: input.port,
      authEnabled: input.authEnabled,
      encryptedCredentials: this.data.encryptedCredentials,
    };
    validate(next, this.errors);
    const credentials = input.credentials;
    if (credentials?.action === 'clear') delete next.encryptedCredentials;
    else if (credentials?.action === 'replace') {
      if (
        typeof credentials.username !== 'string' ||
        !credentials.username ||
        credentials.username.includes(':') ||
        typeof credentials.password !== 'string' ||
        !credentials.password ||
        [credentials.username, credentials.password].some(
          (value) => Buffer.byteLength(value) > 255 || /[\x00-\x1f\x7f]/.test(value),
        )
      )
        throw this.errors.badRequest(
          '请填写有效的代理用户名和密码（各不超过 255 字节，用户名不包含冒号）。',
        );
      if (!this.secrets.available)
        throw this.errors.unavailable('此设备的安全存储不可用，无法保存代理认证。');
      try {
        next.encryptedCredentials = this.secrets.encrypt(
          JSON.stringify({
            username: credentials.username,
            password: credentials.password,
            host: next.host,
            port: next.port,
            protocol: next.protocol,
          }),
        );
      } catch {
        throw this.errors.unavailable('无法加密代理认证信息，原配置已保留。');
      }
    } else if (credentials?.action !== 'keep')
      throw this.errors.badRequest('请选择保留、替换或清除认证信息。');
    if (next.authEnabled && !next.encryptedCredentials)
      throw this.errors.badRequest('开启认证时需要保存用户名和密码。');
    if (next.enabled && next.authEnabled && credentials.action === 'keep') {
      try {
        const stored = JSON.parse(this.secrets.decrypt(next.encryptedCredentials!));
        if (
          stored.host !== next.host ||
          stored.port !== next.port ||
          stored.protocol !== next.protocol
        )
          throw new Error();
      } catch {
        throw this.errors.badRequest('代理地址或安全存储已变化，请重新填写认证信息。');
      }
    }
    try {
      this.document.write(next);
    } catch (error) {
      if (error instanceof StateFault && error.kind === 'conflict') {
        const current = new ProxySettingsStore(this.document, this.secrets, this.errors);
        this.data = current.data;
        this.loadError = current.loadError;
        throw this.errors.conflict('代理配置已变化，请重新加载后重试。');
      }
      throw this.errors.writeFailed('代理配置保存失败，请检查数据目录权限并重新读取核对。');
    }
    this.data = next;
    return this.read();
  }
}
