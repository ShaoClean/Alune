export type ProxyProtocol = 'http' | 'https' | 'socks5';

export interface NetworkProxyConfig {
  revision: string;
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  authEnabled: boolean;
  hasCredentials: boolean;
  secretStorageAvailable: boolean;
}

export interface SaveNetworkProxy {
  revision: string;
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  authEnabled: boolean;
  credentials:
    | { action: 'keep' | 'clear' }
    | {
        action: 'replace';
        username: string;
        password: string;
      };
}

export type GitProxyStatus =
  | 'disabled'
  | 'disconnected'
  | 'preparing'
  | 'ready'
  | 'interrupted'
  | 'denied'
  | 'error';

export interface ProxyConnectionStatus {
  id: string;
  name: string;
  connected: boolean;
  connecting: boolean;
  revision: string | null;
  pendingReconnect: boolean;
  activeTasks: number;
  forwarding: GitProxyStatus;
  error?: string;
}

export interface ProxyTestResult {
  revision: string;
  success: boolean;
  elapsedMs: number;
  message: string;
}
