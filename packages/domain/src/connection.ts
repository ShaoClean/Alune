export interface SSHConnectionConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'sshAgent';
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

// A connection the server has never attempted yet; the UI shows it as untested.
export type ConnectionActivityStatus = ConnectionStatus | 'unknown';

export interface ConnectionStatusInfo {
  status: ConnectionActivityStatus;
  error?: string;
  // Server clock, so a late list response cannot overwrite a newer pushed event.
  updatedAt?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  status: ConnectionActivityStatus;
  error?: string;
  updatedAt?: number;
}

export interface ConnectionInfo {
  id: string;
  config: Omit<SSHConnectionConfig, 'password' | 'privateKey' | 'passphrase'>;
  status: ConnectionActivityStatus;
  lastConnected?: Date;
  error?: string;
}