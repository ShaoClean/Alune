import { ProtocolError } from '@alune/protocol';
import type {
  NetworkProxyConfig,
  ProxyConnectionStatus,
  ProxyTestResult,
  SaveNetworkProxy,
} from '@alune/protocol';

export const proxyApi = {
  settings: (): Promise<NetworkProxyConfig> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 proxyApi.settings。')),
  save: (_input: SaveNetworkProxy): Promise<NetworkProxyConfig> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 proxyApi.save。')),
  connections: (): Promise<ProxyConnectionStatus[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 proxyApi.connections。')),
  reconnect: (_id: string, _revision: string): Promise<ProxyConnectionStatus[]> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 proxyApi.reconnect。')),
  test: (
    _input: {
      kind: 'http' | 'ssh' | 'git';
      revision: string;
      url: string;
      connectionId: string;
      repositoryId: string;
    },
    _signal: AbortSignal,
  ): Promise<ProxyTestResult> =>
    Promise.reject(new Error('Agent 尚未连接，无法执行 proxyApi.test。')),
};

export function proxyError(error: unknown) {
  if (error instanceof ProtocolError) return error.message;
  return '无法完成代理操作，请检查本地服务或网络后重试。';
}
