import axios from 'axios';
import type {
  NetworkProxyConfig,
  ProxyConnectionStatus,
  ProxyTestResult,
  SaveNetworkProxy,
} from '@alune/shared';

const api = axios.create({ baseURL: '/api/network-proxy', timeout: 45_000 });
export const proxyApi = {
  settings: (): Promise<NetworkProxyConfig> => api.get('').then((response) => response.data),
  save: (input: SaveNetworkProxy): Promise<NetworkProxyConfig> =>
    api.put('', input).then((response) => response.data),
  connections: (): Promise<ProxyConnectionStatus[]> =>
    api.get('/connections').then((response) => response.data),
  reconnect: (id: string, revision: string): Promise<ProxyConnectionStatus[]> =>
    api
      .post(`/connections/${encodeURIComponent(id)}/reconnect`, { revision })
      .then((response) => response.data),
  test: (
    input: {
      kind: 'http' | 'ssh' | 'git';
      revision: string;
      url: string;
      connectionId: string;
      repositoryId: string;
    },
    signal: AbortSignal,
  ): Promise<ProxyTestResult> =>
    api.post('/test', input, { signal }).then((response) => response.data),
};

export function proxyError(error: unknown) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.message === 'string')
    return error.response.data.message as string;
  return '无法完成代理操作，请检查本地服务或网络后重试。';
}
